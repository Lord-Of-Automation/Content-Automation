/**
 * The websites a Hostinger account hosts.
 *
 * The second host this console can read, and a much smaller API than the first.
 * Hostinger's hosting surface is three calls: list the websites, create one,
 * delete one. There is no clone, no way to change a site's domain, no cache to
 * purge and no credentials — the WordPress admin password is not something
 * Hostinger will hand back, so those parts of the Applications page simply do
 * not apply to a Hostinger row and say so rather than failing when pressed.
 *
 * Several accounts, one per line, the way Cloudflare's tokens are stored. A
 * token only ever sees the account it was issued for, so an estate spread over
 * two Hostinger accounts needs two lines or half of it stays invisible.
 */

import { credentialFor } from "./providers";

const API = "https://developers.hostinger.com/api";

/** A missing or malformed token, which is fixed on the Keys page. */
export class HostingerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HostingerConfigError";
  }
}

export interface HostingerSite {
  domain: string;
  /** "main", "addon", "subdomain". */
  kind: string;
  enabled: boolean;
  /** The hosting account's shell user, "u709786212". */
  account: string;
  /** Numeric on the wire, kept as a string so it can key a select. */
  clientId: string;
  createdAt: string;
  /** "wordpress", or empty when Hostinger does not say. */
  platform: string;
  /** Which stored token this came from, so rows can be grouped by account. */
  tokenIndex: number;
}

export interface HostingerAccount {
  /** Stable enough to key a filter: the client id, or the line it came from. */
  id: string;
  label: string;
  sites: number;
  ok: boolean;
  note: string;
}

/**
 * One token per line, blank lines and stray whitespace ignored.
 *
 * Trimmed rather than validated. Hostinger tokens carry no prefix to check
 * against, so anything non-empty is worth trying and the API's own refusal is a
 * better error than a guess about the format would be.
 */
export async function tokens(): Promise<string[]> {
  const found = await credentialFor("hostinger");
  const raw = found?.apiToken?.trim();
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function get(token: string, path: string): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  if (response.status === 401 || response.status === 403) {
    throw new HostingerConfigError(
      "Hostinger refused this token. Check it has not expired or been revoked.",
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Hostinger answered ${response.status}${body ? `: ${body.slice(0, 160)}` : ""}`,
    );
  }

  return response.json();
}

interface RawSite {
  domain?: string;
  vhost_type?: string;
  is_enabled?: boolean;
  username?: string;
  client_id?: number | string;
  created_at?: string;
  website_type?: string;
}

/**
 * Every website on one account, following the pages.
 *
 * Hostinger pages at twenty-five and reports the total, so the loop has an end
 * it can see rather than running until a short page turns up. Capped anyway: an
 * API that kept answering "there is more" should cost a bounded number of
 * requests rather than an unbounded one.
 */
async function sitesFor(token: string, tokenIndex: number): Promise<HostingerSite[]> {
  const out: HostingerSite[] = [];

  for (let page = 1; page <= 40; page += 1) {
    const body = (await get(token, `/hosting/v1/websites?page=${page}`)) as {
      data?: RawSite[];
      meta?: { current_page?: number; per_page?: number; total?: number };
    };

    const rows = Array.isArray(body?.data) ? body.data : [];
    for (const raw of rows) {
      const domain = raw.domain?.trim().toLowerCase();
      if (!domain) continue;
      out.push({
        domain,
        kind: raw.vhost_type?.trim() ?? "",
        enabled: raw.is_enabled !== false,
        account: raw.username?.trim() ?? "",
        clientId: String(raw.client_id ?? ""),
        createdAt: raw.created_at?.trim() ?? "",
        platform: raw.website_type?.trim() ?? "",
        tokenIndex,
      });
    }

    const total = body?.meta?.total;
    if (!rows.length || typeof total !== "number" || out.length >= total) break;
  }

  return out;
}

export interface HostingerEstate {
  sites: HostingerSite[];
  accounts: HostingerAccount[];
}

/**
 * Every website across every stored token.
 *
 * One token failing never empties the list. Its account keeps a row saying what
 * happened and the other accounts still come back, because a lapsed token on
 * one account is no reason to hide the sites on another.
 */
export async function listHostingerSites(): Promise<HostingerEstate> {
  const stored = await tokens();
  if (!stored.length) return { sites: [], accounts: [] };

  const results = await Promise.all(
    stored.map(async (token, index) => {
      try {
        const sites = await sitesFor(token, index);
        return { index, sites, error: "" };
      } catch (error) {
        return {
          index,
          sites: [] as HostingerSite[],
          error: error instanceof Error ? error.message : "Could not be read.",
        };
      }
    }),
  );

  const sites = results.flatMap((r) => r.sites);
  const accounts: HostingerAccount[] = results.map((r) => {
    // Named after the hosting account when its sites say what that is, and by
    // position otherwise — which is all there is to go on for a token whose
    // account is empty or whose read failed.
    const account = r.sites[0]?.account;
    const clientId = r.sites[0]?.clientId;
    return {
      id: clientId || `line-${r.index + 1}`,
      label: account ? `Hostinger ${account}` : `Hostinger account ${r.index + 1}`,
      sites: r.sites.length,
      ok: !r.error,
      note: r.error,
    };
  });

  return { sites, accounts };
}

/**
 * Remove a website.
 *
 * The one write Hostinger offers on a hosting account beyond creating, and it
 * is addressed by domain rather than by an id. Everything else in the console
 * that deletes checks the name typed against the thing being removed; here the
 * name and the address are the same string, so the caller passes it twice on
 * purpose and this refuses if they disagree.
 */
export async function deleteHostingerSite(
  tokenIndex: number,
  domain: string,
  confirm: string,
): Promise<void> {
  const wanted = domain.trim().toLowerCase();
  if (confirm.trim().toLowerCase() !== wanted) {
    throw new Error(`Type ${wanted} exactly to confirm the deletion.`);
  }

  const stored = await tokens();
  const token = stored[tokenIndex];
  if (!token) throw new HostingerConfigError("That Hostinger account is no longer configured.");

  const response = await fetch(
    `${API}/hosting/v1/websites/${encodeURIComponent(wanted)}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (response.status === 401 || response.status === 403) {
    throw new HostingerConfigError(
      "Hostinger refused this deletion. The token may not be allowed to write.",
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Hostinger refused the deletion: ${response.status}${body ? `: ${body.slice(0, 160)}` : ""}`,
    );
  }
}
