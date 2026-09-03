/**
 * The domains a Gandi account holds.
 *
 * Read-only, like the GoDaddy reader beside it, and for the same reason: every
 * write on a registrar API either costs money or cannot be undone.
 *
 * Gandi is the easier of the two to price. GoDaddy has no way to ask what an
 * owned domain renews for, so that reader prices an available name and applies
 * the answer to the extension. Gandi answers the renewal question directly,
 * for any name, through its check endpoint — and it will price .fr and .eu,
 * which GoDaddy refuses outright.
 *
 * It is the harder one to read. The domain list carries no name servers, only
 * a one-word category, so the actual hosts come from a call per domain.
 */

import { credentialFor } from "./providers";
import { byExpiry, daysUntil, suffixOf, type Domain, type DomainSource } from "./domains";

const HOST = "https://api.gandi.net/v5";
/** Gandi's own maximum for this endpoint. */
const PAGE = 1000;

/**
 * How many domains to fetch name servers for.
 *
 * One request each, because the list endpoint will not include them. Fine for
 * an account of a few dozen and not something to let run at a thousand, so it
 * stops and the rest simply show no name servers rather than the page hanging.
 */
const NAMESERVER_BUDGET = 60;

/** Prices are per extension and barely move, so they are held for half a day. */
const priceCache = new Map<string, { at: number; micro: number | null; currency: string }>();
const PRICE_TTL = 12 * 60 * 60 * 1000;

interface GandiRow {
  fqdn?: string;
  tld?: string;
  status?: string[];
  autorenew?: boolean | { enabled?: boolean };
  dates?: { registry_ends_at?: string; created_at?: string };
  nameserver?: { current?: string };
}

function authHeader(key: string): Record<string, string> {
  // Gandi's older documentation shows "Apikey <key>" and its current API
  // answers that with a 403. Bearer is what works, for both the newer personal
  // access tokens and the forty-character keys that predate them — checked
  // against the live endpoint rather than taken from either page.
  return { authorization: `Bearer ${key}`, accept: "application/json" };
}

/**
 * Gandi's status is a list of registry codes, not a word.
 *
 * An empty list is an ordinary healthy domain, and clientTransferProhibited is
 * the transfer lock that every sensible registrar sets by default — so
 * reporting either as a problem would mark the whole account as broken. Only
 * the codes that mean something is wrong survive.
 */
function statusOf(codes: string[] | undefined): string {
  const list = (codes ?? []).filter(
    (c) => !/^client(TransferProhibited|UpdateProhibited|DeleteProhibited)$/i.test(c),
  );
  if (!list.length) return "ACTIVE";
  return list.join(", ").toUpperCase();
}

/**
 * What a year's renewal costs at Gandi, in micro-units.
 *
 * The check endpoint answers for a name that does not exist, which is what
 * makes it usable as a per-extension price. Prices come in tiers by term, so
 * the one-year row is the one taken; the multi-year rows are discounts for
 * committing further ahead and would understate a yearly figure.
 *
 * Before tax, to match how the GoDaddy reader quotes. Gandi returns both and
 * the tax rate depends on where the account is billed, which is not a fact
 * this page has.
 */
async function priceOf(suffix: string, key: string): Promise<{ micro: number | null; currency: string }> {
  const cached = priceCache.get(suffix);
  if (cached && Date.now() - cached.at < PRICE_TTL) {
    return { micro: cached.micro, currency: cached.currency };
  }

  let micro: number | null = null;
  let currency = "USD";

  try {
    const url = new URL(`${HOST}/domain/check`);
    url.searchParams.set("name", `zq7x-probe-8813.${suffix}`);
    url.searchParams.set("processes", "renew");
    url.searchParams.set("currency", "USD");

    const response = await fetch(url, {
      headers: authHeader(key),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    if (response.ok) {
      const body = (await response.json()) as {
        currency?: string;
        products?: Array<{
          prices?: Array<{ min_duration?: number; price_before_taxes?: number }>;
        }>;
      };
      currency = body.currency ?? "USD";
      const tiers = body.products?.[0]?.prices ?? [];
      const yearly = tiers.find((p) => p.min_duration === 1) ?? tiers[0];
      if (typeof yearly?.price_before_taxes === "number") {
        micro = Math.round(yearly.price_before_taxes * 1_000_000);
      }
    }
  } catch {
    // A price is a nicety. Nothing here may take the domain list down.
  }

  priceCache.set(suffix, { at: Date.now(), micro, currency });
  return { micro, currency };
}

/** The real hosts, which the list endpoint does not carry. */
async function nameServersOf(fqdn: string, key: string): Promise<string[]> {
  try {
    const response = await fetch(`${HOST}/domain/domains/${encodeURIComponent(fqdn)}`, {
      headers: authHeader(key),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { nameservers?: unknown };
    return Array.isArray(body.nameservers) ? body.nameservers.map(String).slice(0, 6) : [];
  } catch {
    return [];
  }
}

export async function listGandiDomains(): Promise<{ domains: Domain[]; source: DomainSource }> {
  const label = "Gandi";
  const credential = await credentialFor("gandi");
  const key = credential?.apiKey?.trim();

  if (!key) {
    return {
      domains: [],
      source: { provider: "gandi", label, ok: true, count: 0, note: "no credential set", unpriced: [] },
    };
  }

  let rows: GandiRow[];
  try {
    const response = await fetch(`${HOST}/domain/domains?per_page=${PAGE}`, {
      headers: authHeader(key),
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        domains: [],
        source: {
          provider: "gandi",
          label,
          ok: false,
          count: 0,
          note:
            response.status === 401 || response.status === 403
              ? `Gandi refused the key (${response.status}). Check it on the Keys page.`
              : `Gandi answered ${response.status}${body ? `: ${body.slice(0, 140)}` : ""}`,
          unpriced: [],
        },
      };
    }
    const parsed = await response.json();
    rows = Array.isArray(parsed) ? (parsed as GandiRow[]) : [];
  } catch (error) {
    return {
      domains: [],
      source: {
        provider: "gandi",
        label,
        ok: false,
        count: 0,
        note: error instanceof Error ? error.message : "Gandi could not be reached.",
        unpriced: [],
      },
    };
  }

  const domains: Domain[] = rows.map((row) => {
    const fqdn = String(row.fqdn ?? "");
    const expires = row.dates?.registry_ends_at ?? null;
    return {
      provider: "gandi" as const,
      providerLabel: label,
      domain: fqdn,
      suffix: row.tld ? String(row.tld).toLowerCase() : suffixOf(fqdn),
      status: statusOf(row.status),
      expires,
      daysLeft: daysUntil(expires),
      // A boolean in the list and an object in the detail, for the same field.
      renewAuto:
        typeof row.autorenew === "object" ? row.autorenew?.enabled === true : row.autorenew === true,
      nameServers: [],
      renewalPrice: null,
      currency: "USD",
    };
  });

  // Prices once per extension, name servers once per domain, both in small
  // batches: a burst of requests is the shape of traffic that earns a rate
  // limit, and all of this is detail on a list that is already correct.
  const suffixes = [...new Set(domains.map((d) => d.suffix).filter(Boolean))];
  const unpriced: string[] = [];

  for (let i = 0; i < suffixes.length; i += 4) {
    const batch = suffixes.slice(i, i + 4);
    const found = await Promise.all(batch.map((s) => priceOf(s, key)));
    batch.forEach((suffix, at) => {
      const price = found[at];
      if (price.micro === null) unpriced.push(suffix);
      for (const d of domains) {
        if (d.suffix !== suffix) continue;
        d.renewalPrice = price.micro;
        d.currency = price.currency;
      }
    });
  }

  const wanted = domains.slice(0, NAMESERVER_BUDGET);
  for (let i = 0; i < wanted.length; i += 4) {
    const batch = wanted.slice(i, i + 4);
    const found = await Promise.all(batch.map((d) => nameServersOf(d.domain, key)));
    batch.forEach((d, at) => {
      d.nameServers = found[at];
    });
  }

  return {
    domains: byExpiry(domains),
    source: {
      provider: "gandi",
      label,
      ok: true,
      count: domains.length,
      note:
        domains.length > NAMESERVER_BUDGET
          ? `name servers read for the first ${NAMESERVER_BUDGET}, which is one request each`
          : "read",
      unpriced,
    },
  };
}
