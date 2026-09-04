/**
 * Search Console, on a service account.
 *
 * There is no API key for this one. Search Console authenticates with OAuth or
 * with a service account, and a service account has to be added as a user on
 * each property the same way a colleague would be — under Settings, Users and
 * permissions, with the account's own email address. A service account that has
 * not been added simply sees no properties, which reads exactly like an empty
 * account and is a confusing hour if you do not know to check.
 *
 * No SDK. The whole of what this needs is a signed assertion exchanged for a
 * token and two REST calls, which is far less to keep patched than a client
 * library.
 */

import { createSign } from "node:crypto";

import { accessTokenFromRefresh, signedInAs, storedRefreshToken } from "./googleoauth";
import { credentialFor } from "./providers";

const API = "https://searchconsole.googleapis.com/webmasters/v3";
/** Read only. Nothing here should be able to change a property. */
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

export class SearchConsoleConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchConsoleConfigError";
  }
}

export interface SitePerformance {
  /** As Search Console names it: "sc-domain:example.com" or a URL prefix. */
  siteUrl: string;
  /** The bare hostname, for reading. */
  site: string;
  /** "DOMAIN" or "URL_PREFIX", which behave differently and are worth telling apart. */
  kind: string;
  permission: string;
  clicks: number;
  impressions: number;
  /** Click-through rate as a fraction. 0.043 is 4.3 per cent. */
  ctr: number;
  /** Average position. Lower is better, so this one sorts backwards. */
  position: number;
  /** Set when this site could not be read, rather than having no traffic. */
  error: string | null;
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

function account(raw: string): ServiceAccount {
  // Either JSON on one line or base64 of it. One-line JSON carrying a private
  // key is easy to mangle in transit, so both are accepted.
  const text = raw.trim().startsWith("{")
    ? raw
    : Buffer.from(raw.trim(), "base64").toString("utf8");

  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(text) as ServiceAccount;
  } catch {
    throw new SearchConsoleConfigError(
      "That is neither JSON nor base64-encoded JSON. Paste the whole service " +
        "account file that Google downloaded.",
    );
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new SearchConsoleConfigError(
      "That JSON has no client_email or private_key, so it is not a service account key.",
    );
  }
  // Environment files and form fields routinely carry the key with its newlines
  // escaped, which makes the signature fail with a message about the key rather
  // than about the newlines.
  parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return parsed;
}

async function credentials(user: string): Promise<ServiceAccount> {
  const found = await credentialFor("searchconsole");
  const raw = found?.serviceAccount?.trim();
  if (!raw) {
    // What to say depends on how far the setup got, because "add a service
    // account" is the wrong instruction for somebody who has an OAuth client
    // and simply has not pressed Connect — and it is the actively misleading
    // one for somebody whose sign-in has lapsed.
    const hasClient = !!found?.clientId?.trim() && !!found?.clientSecret?.trim();
    const hasToken = !!(await storedRefreshToken(user));

    if (hasToken) {
      throw new SearchConsoleConfigError(
        "The Google sign-in stored here is no longer accepted. Press Connect " +
          "Google on the Keys page to sign in again.",
      );
    }
    if (hasClient) {
      throw new SearchConsoleConfigError(
        "No Google account is connected yet. Press Connect Google on the Keys " +
          "page and sign in with the account that owns your properties.",
      );
    }
    throw new SearchConsoleConfigError(
      "Search Console is not set up. On the Keys page, add a Google OAuth " +
        "client ID and secret, then press Connect Google.",
    );
  }
  return account(raw);
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString("base64url");

/**
 * A token, minted on demand and kept until shortly before it expires.
 *
 * Google issues these for an hour. Minting one per site would be a signature
 * and a round trip for every row of the table.
 */
let token: { value: string; expiresAt: number } | null = null;

async function accessToken(user: string): Promise<string> {
  // A Google sign-in wins whenever there is one. It sees every property that
  // account owns, where a service account sees only the ones somebody
  // remembered to add it to — so preferring it is not a preference, it is the
  // difference between the whole estate and part of it.
  const signedIn = await accessTokenFromRefresh(user);
  if (signedIn) return signedIn;

  if (token && Date.now() < token.expiresAt) return token.value;

  const { client_email, private_key } = await credentials(user);
  const now = Math.floor(Date.now() / 1000);

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: client_email,
      scope: SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );

  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);

  let signature: string;
  try {
    signature = b64url(signer.sign(private_key));
  } catch {
    throw new SearchConsoleConfigError(
      "The private key in that service account could not be used to sign. It is " +
        "usually a key whose newlines were lost in copying.",
    );
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body:
      "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer" +
      `&assertion=${encodeURIComponent(`${header}.${claim}.${signature}`)}`,
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
    throw new Error(
      `Google refused the service account: ${body.error_description ?? body.error ?? response.status}`,
    );
  }

  // A minute early, so a token does not expire between being checked and used.
  token = {
    value: body.access_token,
    expiresAt: Date.now() + Math.max(60, (body.expires_in ?? 3600) - 60) * 1000,
  };
  return token.value;
}

/**
 * Whose access this is reading with, for the page to say.
 *
 * The signed-in account where there is one, because then the service account's
 * email is not the thing anybody needs — and telling somebody to add an address
 * to three hundred properties when the sign-in already covers them all would be
 * a bad hour spent on nothing.
 */
export async function readingAs(
  user: string,
): Promise<{ email: string; kind: "signin" | "service" }> {
  // Not swallowed. A sign-in that fails is the answer, and hiding it behind a
  // fallback made the page complain about a service account nobody was using.
  const mine = await signedInAs(user);
  if (mine) {
    await accessTokenFromRefresh(user);
    return { email: mine, kind: "signin" };
  }

  return { email: (await credentials(user)).client_email, kind: "service" };
}

/** "sc-domain:example.com" and "https://example.com/" both read as example.com. */
function hostOf(siteUrl: string): string {
  if (siteUrl.startsWith("sc-domain:")) return siteUrl.slice("sc-domain:".length);
  try {
    return new URL(siteUrl).hostname.replace(/^www\./, "");
  } catch {
    return siteUrl;
  }
}

/**
 * Every property the service account has been given access to.
 *
 * An empty list is the ordinary answer for an account nobody has added yet, so
 * the caller says so rather than showing an empty table.
 */
async function listSites(user: string): Promise<Array<{ siteUrl: string; permissionLevel: string }>> {
  const response = await fetch(`${API}/sites`, {
    headers: { authorization: `Bearer ${await accessToken(user)}` },
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Search Console answered ${response.status}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }

  const body = (await response.json()) as {
    siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }>;
  };

  return (body.siteEntry ?? [])
    .filter((s) => s.siteUrl)
    .map((s) => ({
      siteUrl: String(s.siteUrl),
      permissionLevel: String(s.permissionLevel ?? "unknown"),
    }));
}

/** Clicks and impressions for one property over a window, as one row. */
async function totalsFor(
  user: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
): Promise<{ clicks: number; impressions: number; ctr: number; position: number } | null> {
  const response = await fetch(
    `${API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${await accessToken(user)}`,
        "content-type": "application/json",
      },
      // No dimensions, so Search Console returns one row: the totals. Asking by
      // date and adding up would be the same numbers and many times the data.
      body: JSON.stringify({ startDate, endDate, dataState: "all" }),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${response.status}${body ? `: ${body.slice(0, 160)}` : ""}`);
  }

  const body = (await response.json()) as {
    rows?: Array<{ clicks?: number; impressions?: number; ctr?: number; position?: number }>;
  };

  const row = body.rows?.[0];
  // No rows is a real answer: the property exists and had no traffic in the
  // window. Reporting that as zero is correct; reporting it as an error is not.
  if (!row) return { clicks: 0, impressions: 0, ctr: 0, position: 0 };

  return {
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr ?? 0,
    position: row.position ?? 0,
  };
}

/** Search Console works in whole days, in the property's own time zone. */
export function windowFor(days: number): { startDate: string; endDate: string } {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date();
  // Yesterday, because today is always partial and a half day beside twenty-seven
  // whole ones makes every trend look like a collapse.
  end.setDate(end.getDate() - 1);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  return { startDate: iso(start), endDate: iso(end) };
}

export interface Performance {
  sites: SitePerformance[];
  startDate: string;
  endDate: string;
  /** Whose access the numbers were read with. */
  readingAs: string;
  /** "signin" or "service" — they need different advice when nothing shows. */
  accessKind: "signin" | "service";
}

/**
 * A window somebody typed, checked against what Search Console will answer.
 *
 * Returns the reason rather than a corrected range. Silently moving a date
 * somebody chose is worse than refusing it: the table would then show a
 * different period from the one on screen, and nothing would say so.
 */
export function checkWindow(start: string, end: string): string | null {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!iso.test(start) || !iso.test(end)) return "Both dates are needed.";

  const from = Date.parse(`${start}T00:00:00Z`);
  const to = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return "That is not a date.";
  if (from > to) return "The first date is after the second.";

  // Today is always partial and tomorrow does not exist yet. Search Console
  // answers for both without complaint, with numbers that look like a collapse.
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  if (to >= today) return "Search Console has no complete day for today yet. End on yesterday or earlier.";

  // Sixteen months is what Search Console keeps. Asking further back returns a
  // shorter period than the one requested, with no indication that it did.
  const oldest = today - 16 * 30 * 86_400_000;
  if (from < oldest) return "Search Console keeps about 16 months. That start date is further back.";

  return null;
}

export async function readPerformance(
  user: string,
  days = 28,
  range?: { startDate: string; endDate: string },
): Promise<Performance> {
  const { startDate, endDate } = range ?? windowFor(days);
  const who = await readingAs(user);
  const properties = await listSites(user);

  const sites: SitePerformance[] = [];

  // Small batches. This is one request per property and Google rate limits per
  // minute, so a hundred fired at once earns a 429 that looks like an outage.
  for (let i = 0; i < properties.length; i += 6) {
    const batch = properties.slice(i, i + 6);
    const rows = await Promise.all(
      batch.map(async (p) => {
        try {
          const totals = await totalsFor(user, p.siteUrl, startDate, endDate);
          return { ...p, totals, error: null as string | null };
        } catch (error) {
          // One property failing must not empty the table. A site added
          // yesterday has no data yet and answers with an error that means
          // exactly that.
          return {
            ...p,
            totals: null,
            error: error instanceof Error ? error.message : "could not be read",
          };
        }
      }),
    );

    for (const r of rows) {
      sites.push({
        siteUrl: r.siteUrl,
        site: hostOf(r.siteUrl),
        kind: r.siteUrl.startsWith("sc-domain:") ? "domain" : "prefix",
        permission: r.permissionLevel.replace(/^site/i, "").toLowerCase() || "unknown",
        clicks: r.totals?.clicks ?? 0,
        impressions: r.totals?.impressions ?? 0,
        ctr: r.totals?.ctr ?? 0,
        position: r.totals?.position ?? 0,
        error: r.error,
      });
    }
  }

  // Most clicks first, which is the order somebody opens this page to see.
  sites.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);

  return { sites, startDate, endDate, readingAs: who.email, accessKind: who.kind };
}
