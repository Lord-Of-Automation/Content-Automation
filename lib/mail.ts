/**
 * The Mailing page's half of the console.
 *
 * The consent runs here, because this is the public half with a login on it and
 * Google has to redirect a browser somewhere. Everything after the consent runs
 * on the engine: it holds the refresh token, it does the sending, and it is the
 * only thing that ever reads a mailbox.
 *
 * That split is deliberate rather than incidental. This app is redeployed
 * whenever anybody pushes and keeps nothing between deploys, so a token stored
 * here would have to live in an environment variable somebody pastes — and the
 * whole point of connecting an account in a browser is that nobody has to.
 *
 * A refresh token passes through this process exactly once, on its way from
 * Google to the droplet, and is never written down here or returned to a page.
 */

import { backend } from "./backend";
import { oauthClient } from "./googleoauth";

/**
 * What the account is asked for.
 *
 * Send, and read. Read is the uncomfortable half, because Gmail offers nothing
 * narrower than a whole mailbox and what is wanted is four conversations — so
 * the narrowing lives in the engine, which only ever asks for a thread it
 * started. Worth knowing when the consent screen lists this and it reads as
 * more than it is.
 */
export const MAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export type MailStatus = {
  /** Whether the engine has an OAuth client to run a consent against. */
  configured: boolean;
  connected: boolean;
  address: string;
  note?: string;
  /** Whether this app has the other half of that client. */
  consoleConfigured?: boolean;
  /** The exact address to register against the OAuth client. */
  redirectUri?: string;
};

export type Contact = {
  row: number;
  domain: string;
  email: string;
  sentAt: string | null;
  sent: number;
};

export type ThreadMessage = {
  id: string;
  from: string;
  to: string;
  subject: string;
  at: string;
  text: string;
  mine: boolean;
};

export type Thread = {
  email: string;
  domain: string;
  threadId: string;
  subject: string;
  sentAt: string;
  sent: number;
  replies: number;
  lastAt?: string;
  messages: ThreadMessage[];
  note?: string;
};

export class NotOnThisBackend extends Error {}

function base(): string {
  const url = process.env.ENGINE_URL?.trim();
  if (!url) throw new Error("ENGINE_URL is not set.");
  return url.replace(/\/+$/, "");
}

function token(): string {
  const value = process.env.ENGINE_TOKEN?.trim();
  if (!value) throw new Error("ENGINE_TOKEN is not set.");
  return value;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (backend() !== "engine") {
    throw new NotOnThisBackend(
      "Mailing runs on the engine, and this deployment is pointed at n8n.",
    );
  }

  const response = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token()}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    // Reading a dozen conversations is a dozen calls to Gmail on the other
    // side, so this waits longer than the schedule calls do.
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });

  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text.slice(0, 300) };
  }

  if (!response.ok) throw new Error(body?.error ?? `The engine answered ${response.status}.`);
  return body as T;
}

/**
 * The OAuth client the consent is granted to.
 *
 * The Search Console one, unless something says otherwise. This console
 * already stores a Google OAuth client — it needs one to read Search Console
 * on somebody's behalf, and it keeps it under Accounts where it can be typed
 * in rather than in an environment variable that needs a redeploy to change.
 *
 * Asking for a second one meant a second client in Google Cloud, two more
 * variables in Vercel, the same two again on the engine, and a redeploy to
 * make any of it take effect. All of that to name the same application twice.
 * One client with the Gmail API enabled and a second redirect address on it
 * does the same job.
 *
 * The environment variables still win where they are set, for anyone who
 * would rather keep outreach on its own client — revoking one grant revokes
 * the other when they share a client, and that is a real reason to separate
 * them.
 */
export async function mailClient(): Promise<{ clientId: string; clientSecret: string } | null> {
  const fromEnv = {
    clientId: process.env.GOOGLE_MAIL_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.GOOGLE_MAIL_CLIENT_SECRET?.trim() ?? "",
  };
  if (fromEnv.clientId && fromEnv.clientSecret) return fromEnv;

  const shared = await oauthClient();
  return shared ? { clientId: shared.clientId, clientSecret: shared.clientSecret } : null;
}

/**
 * Where Google sends the browser back to.
 *
 * It has to match what is registered against the OAuth client exactly, down to
 * the scheme and the trailing path, or Google refuses the whole thing with a
 * mismatch error that names neither side. Taken from the request rather than
 * configured, so a preview deployment and production each ask for their own
 * address instead of one of them silently asking for the other's.
 */
export function callbackUrl(request: Request): string {
  const configured = process.env.MAIL_REDIRECT_URL?.trim();
  if (configured) return configured;
  return new URL("/api/mail/callback", new URL(request.url).origin).toString();
}

/** The consent screen, with everything Google needs to come back usefully. */
export function consentUrl(clientId: string, redirect: string, state: string): string {
  const asked = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: MAIL_SCOPES.join(" "),
    // Offline, or there is no refresh token and the connection dies in an hour.
    access_type: "offline",
    // Google issues a refresh token on first consent only. Without this, a
    // second attempt after a mistake comes back with nothing to store and no
    // explanation of why.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${asked.toString()}`;
}

/** The code Google handed back, exchanged for the token the engine will keep. */
export async function exchangeCode(
  code: string,
  redirect: string,
  client: { clientId: string; clientSecret: string },
): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: redirect,
      grant_type: "authorization_code",
    }).toString(),
    signal: AbortSignal.timeout(30_000),
  });

  const body = (await response.json().catch(() => null)) as {
    refresh_token?: string;
    error?: string;
    error_description?: string;
  } | null;

  if (!response.ok || !body?.refresh_token) {
    /*
     * No refresh token, which is not the same as no token.
     *
     * Google hands one out on the first consent and silently withholds it on
     * every later one unless asked again, so the commonest way to land here is
     * to have connected before. The consent URL asks every time for exactly
     * this reason, and this says so in case it ever stops working.
     */
    const why = body?.error_description ?? body?.error ?? `Google answered ${response.status}`;
    throw new Error(
      body && !body.refresh_token && response.ok
        ? "Google returned no refresh token. Remove this app at " +
          "myaccount.google.com/permissions and connect again."
        : `Google refused the connection: ${why}`,
    );
  }

  return body.refresh_token;
}

export async function mailStatus(): Promise<MailStatus> {
  return call<MailStatus>("/mail/status");
}

/**
 * Hands the engine everything it needs to keep using the consent.
 *
 * The client travels with the token, rather than being configured separately
 * on the engine. It is not a secret the engine has any other use for, and
 * asking somebody to paste the same two values into a second screen before the
 * first one works is how a five-minute setup becomes an afternoon.
 */
export async function connectMail(
  refreshToken: string,
  client: { clientId: string; clientSecret: string },
): Promise<{ address: string }> {
  return call<{ address: string }>("/mail/connect", {
    method: "POST",
    body: JSON.stringify({
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }),
  });
}

export async function disconnectMail(): Promise<void> {
  await call("/mail/connect", { method: "DELETE" });
}

export async function mailContacts(sheet: string, tab: string): Promise<Contact[]> {
  const asked = new URLSearchParams();
  if (sheet) asked.set("sheet", sheet);
  if (tab) asked.set("tab", tab);
  const { contacts } = await call<{ contacts: Contact[] }>(
    `/mail/contacts${asked.toString() ? `?${asked}` : ""}`,
  );
  return contacts ?? [];
}

export async function sendToProspect(input: {
  to: string;
  subject: string;
  body: string;
  domain: string;
}): Promise<void> {
  await call("/mail/send", { method: "POST", body: JSON.stringify(input) });
}

export async function mailThreads(): Promise<{ threads: Thread[]; address: string }> {
  const answer = await call<{ threads: Thread[]; address?: string }>("/mail/threads");
  return { threads: answer.threads ?? [], address: answer.address ?? "" };
}

export async function forgetThread(email: string): Promise<void> {
  await call(`/mail/threads/${encodeURIComponent(email)}`, { method: "DELETE" });
}
