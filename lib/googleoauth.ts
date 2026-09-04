/**
 * Signing in to Google as yourself, so Search Console needs no user management.
 *
 * A service account is a separate identity that has to be added to each
 * property by hand, and with a few hundred properties that is a few hundred
 * visits to the same settings page. Signing in as the person who owns them
 * skips all of it: the token sees everything that account owns, including
 * properties added later.
 *
 * What is stored is a refresh token, which is a long-lived key to that Google
 * account's Search Console data. It is encrypted at rest with the same scheme
 * as every other credential here, and never leaves the server.
 *
 * One thing that surprises people: while the consent screen is in Testing
 * rather than Published, Google expires refresh tokens after seven days and the
 * connection has to be made again. That is Google's rule, not this app's, and
 * the Keys page says so rather than letting it look like a bug.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { credentialFor } from "./providers";

/** Read only. Nothing here should be able to change a property. */
export const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export class GoogleOAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleOAuthError";
  }
}

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export async function oauthClient(): Promise<OAuthClient | null> {
  const found = await credentialFor("searchconsole");
  const clientId = found?.clientId?.trim();
  const clientSecret = found?.clientSecret?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

export async function storedRefreshToken(): Promise<string | null> {
  const found = await credentialFor("searchconsole");
  return found?.refreshToken?.trim() || null;
}

/**
 * Where Google sends the browser back to.
 *
 * Derived from the request rather than configured, so the same code works on a
 * preview deployment and in production without a variable that is wrong on one
 * of them. Whatever this returns has to be registered on the OAuth client
 * verbatim — Google compares it as a string, and a trailing slash is a
 * different string.
 */
export function redirectUri(request: Request): string {
  const url = new URL(request.url);
  // Vercel terminates TLS at the edge, so the request arriving at the function
  // says http. The forwarded header is what the browser actually used.
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  return `${proto}://${host}/api/google/callback`;
}

/**
 * A state parameter that proves the callback belongs to a request we started.
 *
 * Signed rather than stored, so there is no session to keep and nothing to
 * clean up. It carries the time it was made, and anything older than ten
 * minutes is refused — a consent screen left open overnight is not a
 * conversation worth resuming.
 */
function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new GoogleOAuthError("AUTH_SECRET is not set, so the sign-in cannot be secured.");
  return value;
}

export function makeState(): string {
  const issued = Date.now().toString(36);
  const mac = createHmac("sha256", secret()).update(issued).digest("base64url");
  return `${issued}.${mac}`;
}

export function checkState(state: string): boolean {
  const [issued, mac] = String(state || "").split(".");
  if (!issued || !mac) return false;

  const expected = createHmac("sha256", secret()).update(issued).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  // Compared in constant time, and only after the lengths match — timingSafeEqual
  // throws on a length mismatch rather than returning false.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const age = Date.now() - parseInt(issued, 36);
  return age >= 0 && age < 10 * 60 * 1000;
}

export function consentUrl(client: OAuthClient, redirect: string, state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", client.clientId);
  url.searchParams.set("redirect_uri", redirect);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  // Offline is what asks for a refresh token at all, and consent forces one to
  // be issued even when this account has approved before — without it a second
  // connection comes back with no refresh token and looks like a silent failure.
  url.searchParams.set("access_type", "offline");
  // Both prompts, space separated. Consent alone signs in whichever Google
  // account the browser is already in, with no way to pick another — and the
  // account that owns the properties is routinely not the one somebody happens
  // to be logged into. select_account brings back the chooser.
  url.searchParams.set("prompt", "select_account consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

/** Trades the one-time code for a refresh token. */
export async function exchangeCode(
  client: OAuthClient,
  code: string,
  redirect: string,
): Promise<{ refreshToken: string; email: string | null }> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirect,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  const body = (await response.json().catch(() => ({}))) as {
    refresh_token?: string;
    access_token?: string;
    error_description?: string;
    error?: string;
  };

  if (!body.refresh_token) {
    throw new GoogleOAuthError(
      body.error_description ??
        body.error ??
        "Google returned no refresh token. That happens when the consent screen " +
          "was skipped, which usually means this account had already approved it.",
    );
  }

  // Whose account it is, so the Keys page can say. Best effort: the connection
  // works without it.
  let email: string | null = null;
  if (body.access_token) {
    try {
      const who = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { authorization: `Bearer ${body.access_token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (who.ok) email = ((await who.json()) as { email?: string }).email ?? null;
    } catch {
      /* the name is a nicety */
    }
  }

  return { refreshToken: body.refresh_token, email };
}

/** Cached until shortly before it expires, like the service account's. */
let access: { value: string; expiresAt: number } | null = null;

/**
 * An access token from the stored refresh token, or null when not connected.
 *
 * Null rather than throwing, because not being connected is an ordinary state
 * that the caller answers by falling back to the service account.
 */
export async function accessTokenFromRefresh(): Promise<string | null> {
  if (access && Date.now() < access.expiresAt) return access.value;

  const client = await oauthClient();
  const refresh = await storedRefreshToken();
  if (!client || !refresh) return null;

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      client_secret: client.clientSecret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
    error?: string;
  };

  if (!body.access_token) {
    // invalid_grant is the one worth naming: it is what an expired or revoked
    // refresh token says, and on a Testing consent screen it means the seven
    // days are up rather than that anything is misconfigured.
    // The three that mean different things and all read as "refused".
    if (body.error === "invalid_grant") {
      throw new GoogleOAuthError(
        "Google no longer accepts the stored sign-in. If the consent screen is " +
          "still in Testing, refresh tokens expire after seven days — press " +
          "Connect again. Otherwise the access was revoked.",
      );
    }
    if (body.error === "unauthorized_client" || body.error === "invalid_client") {
      throw new GoogleOAuthError(
        "The stored sign-in belongs to a different OAuth client than the one " +
          "configured now. A refresh token only works with the client that " +
          "issued it, so press Connect again to sign in through this one.",
      );
    }
    throw new GoogleOAuthError(
      `Google refused the stored sign-in: ${body.error_description ?? body.error ?? response.status}`,
    );
  }

  access = {
    value: body.access_token,
    expiresAt: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 60) * 1000,
  };
  return access.value;
}

/** Dropped when the credential changes, so a new sign-in is not shadowed. */
export function forgetAccessToken(): void {
  access = null;
}
