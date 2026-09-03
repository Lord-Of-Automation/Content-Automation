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

export class GoDaddyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoDaddyConfigError";
  }
}

/** What the list page shows for one domain. */
export interface Domain {
  domain: string;
  domainId: number | null;
  status: string;
  /** ISO date, or null for a domain with no expiry recorded. */
  expires: string | null;
  createdAt: string | null;
  renewAuto: boolean;
  locked: boolean;
  privacy: boolean;
  /** Days until expiry, negative once past. Null when there is no expiry. */
  daysLeft: number | null;
  nameServers: string[];
}

export interface DomainList {
  domains: Domain[];
  /** Which authorization scheme the API accepted, for the diagnostics line. */
  scheme: string;
  /** True when the account holds more than this page fetched. */
  truncated: boolean;
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
function schemes(): Array<{ name: string; value: string }> {
  const key = process.env.GODADDY_API_KEY?.trim();
  const secret = process.env.GODADDY_API_SECRET?.trim();

  if (!key) {
    throw new GoDaddyConfigError(
      "GODADDY_API_KEY is not set, so there is no account to list domains for. " +
        "Add it in the project's environment variables and redeploy.",
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

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.round((at - Date.now()) / 86_400_000);
}

function shape(raw: Record<string, unknown>): Domain {
  const expires = typeof raw.expires === "string" ? raw.expires : null;
  return {
    domain: String(raw.domain ?? ""),
    domainId: typeof raw.domainId === "number" ? raw.domainId : null,
    status: String(raw.status ?? "UNKNOWN"),
    expires,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : null,
    renewAuto: raw.renewAuto === true,
    locked: raw.locked === true,
    privacy: raw.privacy === true,
    daysLeft: daysUntil(expires),
    nameServers: Array.isArray(raw.nameServers)
      ? (raw.nameServers as unknown[]).map(String).slice(0, 6)
      : [],
  };
}

/**
 * Every domain on the account, oldest expiry first.
 *
 * Paged with `marker`, which is the last domain of the previous page rather
 * than an offset — so a page that comes back short is the end, and a page that
 * comes back full means asking again from that name.
 */
export async function listDomains(): Promise<DomainList> {
  const tried: string[] = [];
  let lastAuthError = "";

  for (const scheme of schemes()) {
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
        return {
          domains: sort(collected),
          scheme: scheme.name,
          truncated: false,
        };
      }

      const last = collected[collected.length - 1]?.domain ?? "";
      if (!last) break;
      page = await fetchPage(scheme.value, last);
      if (page.status < 200 || page.status >= 300) break;
    }

    return { domains: sort(collected), scheme: scheme.name, truncated: true };
  }

  throw new Error(
    lastAuthError ||
      `GoDaddy rejected the token (tried ${tried.join(" and ") || "every scheme"}).`,
  );
}

/**
 * Soonest to expire first, because that is the only column anyone opens this
 * page in a hurry to read. Domains with no expiry sort to the bottom rather
 * than the top, where a missing date would otherwise look like an emergency.
 */
function sort(domains: Domain[]): Domain[] {
  return [...domains].sort((a, b) => {
    if (a.daysLeft === null && b.daysLeft === null) return a.domain.localeCompare(b.domain);
    if (a.daysLeft === null) return 1;
    if (b.daysLeft === null) return -1;
    return a.daysLeft - b.daysLeft;
  });
}
