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

import { accessTokenFromRefresh } from "./googleoauth";
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

async function credentials(): Promise<ServiceAccount> {
  const found = await credentialFor("searchconsole");
  const raw = found?.serviceAccount?.trim();
  if (!raw) {
    throw new SearchConsoleConfigError(
      "No Search Console service account is set. Add it on the Keys page under " +
        "Domain providers.",
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

async function accessToken(): Promise<string> {
  // A Google sign-in wins whenever there is one. It sees every property that
  // account owns, where a service account sees only the ones somebody
  // remembered to add it to — so preferring it is not a preference, it is the
  // difference between the whole estate and part of it.
  const signedIn = await accessTokenFromRefresh();
  if (signedIn) return signedIn;

  if (token && Date.now() < token.expiresAt) return token.value;

  const { client_email, private_key } = await credentials();
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
export async function readingAs(): Promise<{ email: string; kind: "signin" | "service" }> {
  const found = await credentialFor("searchconsole");
  if (await accessTokenFromRefresh().catch(() => null)) {
    return { email: found?.googleEmail?.trim() || "a signed-in Google account", kind: "signin" };
  }
  return { email: (await credentials()).client_email, kind: "service" };
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
async function listSites(): Promise<Array<{ siteUrl: string; permissionLevel: string }>> {
  const response = await fetch(`${API}/sites`, {
    headers: { authorization: `Bearer ${await accessToken()}` },
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
  siteUrl: string,
  startDate: string,
  endDate: string,
): Promise<{ clicks: number; impressions: number; ctr: number; position: number } | null> {
  const response = await fetch(
    `${API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${await accessToken()}`,
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

export async function readPerformance(days = 28): Promise<Performance> {
  const { startDate, endDate } = windowFor(days);
  const who = await readingAs();
  const properties = await listSites();

  const sites: SitePerformance[] = [];

  // Small batches. This is one request per property and Google rate limits per
  // minute, so a hundred fired at once earns a 429 that looks like an outage.
  for (let i = 0; i < properties.length; i += 6) {
    const batch = properties.slice(i, i + 6);
    const rows = await Promise.all(
      batch.map(async (p) => {
        try {
          const totals = await totalsFor(p.siteUrl, startDate, endDate);
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
