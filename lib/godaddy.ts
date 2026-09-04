/**
 * The domains a GoDaddy account owns.
 *
 * Read-only, and deliberately so: this page exists to show what the account
 * holds, not to renew, transfer or reconfigure anything. Every one of those is
 * irreversible or costs money, and neither belongs behind a page you might open
 * to check an expiry date.
 *
 * The credential lives in the environment rather than in this repository or in
 * the browser. It is a Personal Access Token with full account scope — enough
 * to buy and move domains — so it never leaves the server, and no route here
 * ever returns it, not even masked.
 */

import { credentialFor } from "./providers";
import { byExpiry, daysUntil, suffixOf, type Domain, type DomainSource } from "./domains";

export class GoDaddyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoDaddyConfigError";
  }
}

/**
 * What a year costs, for one suffix.
 *
 * GoDaddy will not tell you what an owned domain renews for. There is no price
 * on the domain record, no price on the domain detail, and the endpoints that
 * would know — subscriptions and orders — refuse this token outright. What it
 * will tell you is the price of a domain that is still available, and that
 * response carries a renewalPrice as well as a registration price.
 *
 * So the price is looked up once per suffix, against a name nobody has
 * registered, and applied to every domain on that suffix. It is GoDaddy's list
 * price for the extension rather than a quote for the specific domain, which
 * matters: a Discount Domain Club membership, a multi-year deal, a promotional
 * first year, or a premium name will all differ from it. The page says so
 * rather than presenting it as an invoice.
 */
export interface TldPrice {
  suffix: string;
  /** Micro-units, as GoDaddy sends them. 22990000 is 22.99. */
  renewal: number | null;
  register: number | null;
  currency: string;
}


const HOST = "https://api.godaddy.com";
/** The API's own ceiling. Asking for more is a 422, not a clamp. */
const PAGE = 1000;
/** Enough for any account this console will ever look at, and a stop. */
const MAX_PAGES = 10;

/**
 * The header, or headers, worth trying.
 *
 * GoDaddy has two credential formats. A Personal Access Token is one opaque
 * string sent as "Bearer <token>"; the older developer credential is a pair
 * sent as "sso-key KEY:SECRET". They are different credential types, not two
 * spellings of one, and the underscores inside a PAT are part of the token
 * rather than a delimiter to split on.
 *
 * The v1 OpenAPI document settles it: its only declared security scheme is
 * bearerAuth, applied to every operation, with no sso-key scheme defined at
 * all. Checked against the live endpoint as well — Bearer answers 200 and
 * sso-key answers 401 for the same token.
 *
 * So a token that announces itself with gd_pat_ goes straight to Bearer and
 * costs no wasted round trip. Anything else is a shape we cannot read off the
 * string, and there both are tried in turn.
 */
function schemes(key: string | null): Array<{ name: string; value: string }> {
  const secret = process.env.GODADDY_API_SECRET?.trim();

  if (!key) {
    throw new GoDaddyConfigError(
      "No GoDaddy token is set, so there is no account to list domains for. " +
        "Add one on the Keys page, or set GODADDY_API_KEY in the project's " +
        "environment variables.",
    );
  }

  // A key and a secret can only be the classic pair, so there is nothing to try.
  if (secret) return [{ name: "sso-key with secret", value: `sso-key ${key}:${secret}` }];

  const bearer = { name: "bearer", value: `Bearer ${key}` };
  if (key.startsWith("gd_pat_")) return [bearer];

  return [bearer, { name: "sso-key", value: `sso-key ${key}` }];
}

/** Whether GoDaddy is telling us the credential is wrong, rather than the request. */
function isAuthFailure(status: number): boolean {
  return status === 401;
}

/**
 * What GoDaddy said, in words worth showing someone.
 *
 * Its errors are JSON with a code and a message, and the codes matter here.
 * ACCESS_DENIED on this endpoint is not a broken token: since 2024 the domains
 * API is only open to accounts above a certain size, and an account below it
 * gets a perfectly valid token that this one endpoint refuses. Somebody reading
 * "403" alone would go and regenerate a key that was never the problem.
 */
function explain(status: number, body: string): string {
  let code = "";
  let message = "";
  try {
    const parsed = JSON.parse(body) as { code?: string; message?: string };
    code = parsed.code ?? "";
    message = parsed.message ?? "";
  } catch {
    message = body.replace(/\s+/g, " ").slice(0, 200);
  }

  // Two different problems arrive as 403, and GoDaddy's own guidance is to
  // read the code rather than the status to tell them apart. One is the token
  // missing a scope, which is fixed by issuing a new token with the right
  // permissions. The other is the account not qualifying for this endpoint at
  // all, which no token can fix. Saying "the token is fine" for both, as this
  // used to, sends half of the people who see it to the wrong place.
  if (status === 403) {
    if (/ACCESS_DENIED|NOT_ELIGIBLE/i.test(code)) {
      return (
        `GoDaddy refused this endpoint for the account (${code})` +
        (message ? `: ${message}. ` : ". ") +
        "The token is not the problem. GoDaddy gates the domains API on account " +
        "standing, so a valid token still gets refused on an account that does " +
        "not qualify. Their support can confirm whether it does."
      );
    }
    return (
      `GoDaddy refused the request${code ? ` (${code})` : ""}` +
      (message ? `: ${message}. ` : ". ") +
      "A 403 here is usually the token lacking the domains read permission. " +
      "Reissue it in Account > API Keys with domains access and update " +
      "GODADDY_API_KEY."
    );
  }
  if (status === 429) {
    return "GoDaddy is rate limiting this token. Wait a minute and reload.";
  }
  if (status === 422) {
    return `GoDaddy rejected the request as malformed${message ? ` — ${message}` : ""}.`;
  }
  return `GoDaddy answered ${status}${code ? ` (${code})` : ""}${message ? `: ${message}` : ""}`;
}

async function fetchPage(
  authorization: string,
  marker: string,
): Promise<{ status: number; body: string }> {
  const url = new URL(`${HOST}/v1/domains`);
  url.searchParams.set("limit", String(PAGE));
  // Only what the account still holds. Without this the list fills with
  // domains transferred away years ago, which is history rather than an asset.
  url.searchParams.set("statusGroups", "VISIBLE");
  url.searchParams.set("includes", "nameServers");
  if (marker) url.searchParams.set("marker", marker);

  const response = await fetch(url, {
    headers: { authorization, accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  return { status: response.status, body: await response.text().catch(() => "") };
}

function shape(raw: Record<string, unknown>): Domain {
  const expires = typeof raw.expires === "string" ? raw.expires : null;
  const domain = String(raw.domain ?? "");
  return {
    provider: "godaddy",
    providerLabel: "GoDaddy",
    domain,
    suffix: suffixOf(domain),
    status: String(raw.status ?? "UNKNOWN"),
    expires,
    daysLeft: daysUntil(expires),
    renewAuto: raw.renewAuto === true,
    nameServers: Array.isArray(raw.nameServers)
      ? (raw.nameServers as unknown[]).map(String).slice(0, 6)
      : [],
    // Filled in by finish(), once per extension rather than once per domain.
    renewalPrice: null,
    currency: "USD",
  };
}

/**
 * Prices change rarely and this costs a request per suffix, so they are held
 * for half a day. Per server instance, which is enough: a cold instance simply
 * looks them up again, and a stale price for a few hours is not a problem worth
 * a shared cache.
 */
const priceCache = new Map<string, { at: number; price: TldPrice | null }>();
const PRICE_TTL = 12 * 60 * 60 * 1000;

/**
 * Names that will not be registered, used to ask what a suffix costs.
 *
 * Two of them, because the answer only carries prices when the name is
 * actually available — a probe that happened to be taken would come back with
 * nothing to read and look like an unpriceable suffix.
 */
const PROBES = ["zq7x-probe-8813", "vk42-probe-1197"];

async function priceOf(suffix: string, authorization: string): Promise<TldPrice | null> {
  const cached = priceCache.get(suffix);
  if (cached && Date.now() - cached.at < PRICE_TTL) return cached.price;

  let found: TldPrice | null = null;

  for (const stem of PROBES) {
    try {
      const url = new URL(`${HOST}/v1/domains/available`);
      url.searchParams.set("domain", `${stem}.${suffix}`);
      // FULL is what carries the money. The quick check answers only whether
      // the name is taken.
      url.searchParams.set("checkType", "FULL");

      const response = await fetch(url, {
        headers: { authorization, accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      // Several country registries refuse this check outright with a 422,
      // whatever name is asked about. Those suffixes simply have no price here.
      if (!response.ok) continue;

      const body = (await response.json()) as {
        available?: boolean;
        currency?: string;
        price?: number;
        renewalPrice?: number;
      };
      if (!body.available || typeof body.renewalPrice !== "number") continue;

      found = {
        suffix,
        renewal: body.renewalPrice,
        register: typeof body.price === "number" ? body.price : null,
        currency: body.currency ?? "USD",
      };
      break;
    } catch {
      // A price is a nicety. Nothing here may take the domain list down.
    }
  }

  priceCache.set(suffix, { at: Date.now(), price: found });
  return found;
}

/**
 * A price for every suffix the account holds.
 *
 * One lookup per suffix rather than per domain: this account has 388 domains
 * across 25 suffixes, so it is 25 requests instead of 388, and the answer is
 * the same either way because GoDaddy prices by extension.
 *
 * Run in small batches. Twenty-five requests fired at once is the shape of
 * traffic that earns a rate limit, and the whole thing is decoration on a page
 * that has already loaded its real content.
 */
async function pricesFor(
  suffixes: string[],
  authorization: string,
): Promise<{ prices: Record<string, TldPrice>; unpriced: string[] }> {
  const prices: Record<string, TldPrice> = {};
  const unpriced: string[] = [];

  for (let i = 0; i < suffixes.length; i += 5) {
    const batch = suffixes.slice(i, i + 5);
    const found = await Promise.all(batch.map((s) => priceOf(s, authorization)));
    batch.forEach((suffix, at) => {
      const price = found[at];
      if (price) prices[suffix] = price;
      else unpriced.push(suffix);
    });
  }

  return { prices, unpriced };
}


/**
 * The answer, with prices attached to the rows.
 *
 * Both exits from the paging loop come through here so they cannot drift
 * apart, and so the price lookup is written once rather than twice. The price
 * lands on each domain rather than in a table beside it, because the same
 * extension costs different money at a different registrar.
 */
async function finish(
  collected: Domain[],
  scheme: { name: string; value: string },
  truncated: boolean,
): Promise<{ domains: Domain[]; source: DomainSource }> {
  const suffixes = [...new Set(collected.map((d) => d.suffix).filter(Boolean))].sort();
  const { prices, unpriced } = await pricesFor(suffixes, scheme.value);

  for (const d of collected) {
    const price = prices[d.suffix];
    if (!price) continue;
    d.renewalPrice = price.renewal;
    d.currency = price.currency;
  }

  return {
    domains: byExpiry(collected),
    source: {
      provider: "godaddy",
      label: "GoDaddy",
      ok: true,
      count: collected.length,
      // Silent on the happy path. This used to name the authorization scheme,
      // which was worth showing while it was still unknown which one GoDaddy
      // accepted and is noise now that it is settled.
      note: truncated
        ? "more domains than one read returns; this is the first several thousand"
        : "read",
      unpriced,
    },
  };
}

/**
 * Every domain on the account, oldest expiry first.
 *
 * Paged with `marker`, which is the last domain of the previous page rather
 * than an offset — so a page that comes back short is the end, and a page that
 * comes back full means asking again from that name.
 */
export async function listGoDaddyDomains(): Promise<{ domains: Domain[]; source: DomainSource }> {
  const tried: string[] = [];
  let lastAuthError = "";

  // Whatever the Keys page holds for GoDaddy, falling back to the environment.
  const token = (await credentialFor("godaddy"))?.token ?? null;

  for (const scheme of schemes(token)) {
    const first = await fetchPage(scheme.value, "");

    if (isAuthFailure(first.status)) {
      tried.push(scheme.name);
      lastAuthError = explain(first.status, first.body);
      continue;
    }
    if (first.status < 200 || first.status >= 300) {
      // Not an authentication problem, so trying the other header would only
      // ask the same rejected question a second time.
      throw new Error(explain(first.status, first.body));
    }

    const collected: Domain[] = [];
    let page = first;
    let pages = 0;

    while (pages < MAX_PAGES) {
      pages += 1;
      let rows: unknown;
      try {
        rows = JSON.parse(page.body);
      } catch {
        throw new Error("GoDaddy answered with something that is not JSON.");
      }
      if (!Array.isArray(rows)) {
        throw new Error("GoDaddy answered with something that is not a list of domains.");
      }

      collected.push(...rows.map((r) => shape(r as Record<string, unknown>)));
      if (rows.length < PAGE) {
        return finish(collected, scheme, false);
      }

      const last = collected[collected.length - 1]?.domain ?? "";
      if (!last) break;
      page = await fetchPage(scheme.value, last);
      if (page.status < 200 || page.status >= 300) break;
    }

    return finish(collected, scheme, true);
  }

  throw new Error(
    lastAuthError ||
      `GoDaddy rejected the token (tried ${tried.join(" and ") || "every scheme"}).`,
  );
}

