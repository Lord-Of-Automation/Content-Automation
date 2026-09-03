"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  orderDomains, pointsAt, statusTone, type Direction, type SortKey,
} from "@/lib/domainsort";

type Domain = {
  domain: string;
  domainId: number | null;
  status: string;
  expires: string | null;
  createdAt: string | null;
  renewAuto: boolean;
  locked: boolean;
  privacy: boolean;
  daysLeft: number | null;
  nameServers: string[];
  suffix: string;
};

type TldPrice = {
  suffix: string;
  /** Micro-units, as GoDaddy sends them. 22990000 is 22.99. */
  renewal: number | null;
  register: number | null;
  currency: string;
};

/** GoDaddy prices in millionths. Rendered in the viewer's own locale. */
function money(micro: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(micro / 1_000_000);
  } catch {
    // An unexpected currency code would otherwise throw and take the row down.
    return `${(micro / 1_000_000).toFixed(2)} ${currency}`;
  }
}

const PAGE = 50;

/**
 * Which way each column reads first.
 *
 * Clicking a column should show you the interesting end of it straight away.
 * For a name that is A to Z; for money and for time it is the largest and the
 * soonest, because nobody clicks "expires" hoping to see the domain furthest
 * from expiring.
 */
const FIRST_DIRECTION: Record<SortKey, Direction> = {
  domain: "asc",
  status: "asc",
  expires: "asc",
  renewal: "asc",
  price: "desc",
  ns: "asc",
};

function Chevrons({ state }: { state: "none" | "asc" | "desc" }) {
  return (
    <svg className={`sortmark is-${state}`} viewBox="0 0 10 14" aria-hidden>
      <path className="sortmark-up" d="M5 1.5 8.2 5.4H1.8z" />
      <path className="sortmark-down" d="M5 12.5 1.8 8.6h6.4z" />
    </svg>
  );
}

/**
 * How urgent an expiry is.
 *
 * Thirty days is the line because that is roughly when a renewal stops being
 * something to schedule and starts being something to do. Ninety is worth
 * marking too: a domain a quarter from expiry is fine, but it is the one to
 * look at when deciding what to let go.
 */
function expiryTone(days: number | null, renewAuto: boolean): string {
  if (days === null) return "idle";
  if (days < 0) return "bad";
  if (days <= 30) return renewAuto ? "warn" : "bad";
  if (days <= 90) return "warn";
  return "ok";
}

function expiryText(days: number | null, expires: string | null): string {
  if (days === null || !expires) return "no expiry recorded";
  if (days < 0) return `expired ${Math.abs(days)}d ago`;
  if (days === 0) return "expires today";
  if (days <= 90) return `${days}d left`;
  return new Date(expires).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}


function prettyStatus(status: string): string {
  return status.toLowerCase().replace(/_/g, " ");
}


export default function DomainsView() {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [scheme, setScheme] = useState<string>("");
  const [truncated, setTruncated] = useState(false);
  const [prices, setPrices] = useState<Record<string, TldPrice>>({});
  const [unpriced, setUnpriced] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState(false);
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE);
  const [sortKey, setSortKey] = useState<SortKey>("expires");
  const [direction, setDirection] = useState<Direction>("asc");
  const [only, setOnly] = useState<"all" | "soon" | "manual" | "parked" | "trouble">("all");

  function sortBy(key: SortKey) {
    // Same column flips; a new column starts at its own natural end rather
    // than inheriting whichever direction the last one happened to be in.
    if (key === sortKey) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection(FIRST_DIRECTION[key]);
    }
    setVisible(PAGE);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/domains", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) {
        setConfigError(payload.kind === "config");
        throw new Error(payload.error ?? `The domains API returned ${response.status}.`);
      }
      setDomains(payload.domains ?? []);
      setScheme(payload.scheme ?? "");
      setTruncated(!!payload.truncated);
      setPrices(payload.prices ?? {});
      setUnpriced(payload.unpriced ?? []);
      setConfigError(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach GoDaddy.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const kept = domains.filter((d) => {
      if (needle && !d.domain.toLowerCase().includes(needle)) return false;
      if (only === "soon") return d.daysLeft !== null && d.daysLeft <= 30;
      if (only === "manual") return !d.renewAuto;
      if (only === "parked") return pointsAt(d.nameServers).label === "parked at GoDaddy";
      if (only === "trouble") return statusTone(d.status) !== "ok";
      return true;
    });

    return orderDomains(kept, sortKey, direction, prices);
  }, [domains, query, only, sortKey, direction, prices]);

  // Counted over everything, not over what the search box left behind: these
  // are facts about the account, and they should not change as you type.
  const soon = domains.filter((d) => d.daysLeft !== null && d.daysLeft <= 30).length;
  const manual = domains.filter((d) => !d.renewAuto).length;

  /**
   * What a full year of renewals comes to.
   *
   * The number nobody has, because GoDaddy's own interface shows one price at a
   * time. Only over the domains that could be priced, and the currencies are
   * kept apart rather than added together — the list is quoted in one currency
   * today, but summing two would be quietly wrong on the day it is not.
   */
  const totalOver = useCallback(
    (list: Domain[]) => {
      const totals = new Map<string, number>();
      let counted = 0;
      for (const d of list) {
        const price = prices[d.suffix];
        if (!price?.renewal) continue;
        totals.set(price.currency, (totals.get(price.currency) ?? 0) + price.renewal);
        counted += 1;
      }
      return { totals: [...totals.entries()], counted };
    },
    [prices],
  );

  const yearly = useMemo(() => totalOver(domains), [domains, totalOver]);
  // What the filter is showing, so narrowing to one brand answers "and what
  // does that cost" without a calculator.
  const shownYearly = useMemo(() => totalOver(shown), [shown, totalOver]);

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Domains</h2>
            <p>
              Everything this GoDaddy account holds, soonest to expire first.
              Read only &mdash; nothing here renews, moves or changes a domain.
            </p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>

        <div className="card-body tight">
          {error ? (
            <div className="notice bad">
              {error}
              {configError ? (
                <>
                  {" "}
                  Set <code>GODADDY_API_KEY</code> in the project&rsquo;s
                  environment variables and redeploy.
                </>
              ) : null}
            </div>
          ) : null}

          {truncated ? (
            <div className="notice warn">
              This account holds more domains than one read returns. The list
              below is the first several thousand, soonest to expire first.
            </div>
          ) : null}

          {loading && !domains.length ? (
            <div className="empty">Asking GoDaddy…</div>
          ) : !domains.length && !error ? (
            <div className="empty">This account holds no domains.</div>
          ) : domains.length ? (
            <>
              {/* The four numbers worth having before the table.
                  The renewal total leads because it is the one that decides
                  anything: it is what the account costs to keep, and GoDaddy
                  shows one price at a time so nowhere else adds it up. It was
                  previously a clause in a line of grey text beside the search
                  box, where it read as a footnote to a filter. */}
              <div className="domain-stats">
                {yearly.totals.length ? (
                  yearly.totals.map(([currency, total]) => (
                    <div className="domain-stat is-lead" key={currency}>
                      <span className="domain-stat-value">{money(total, currency)}</span>
                      <span className="domain-stat-label">
                        renewals a year
                        {yearly.counted < domains.length ? (
                          <> &middot; {domains.length - yearly.counted} unpriced</>
                        ) : null}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="domain-stat is-lead">
                    <span className="domain-stat-value">&mdash;</span>
                    <span className="domain-stat-label">renewals a year</span>
                  </div>
                )}

                <div className="domain-stat">
                  <span className="domain-stat-value">{domains.length}</span>
                  <span className="domain-stat-label">
                    domain{domains.length === 1 ? "" : "s"}
                  </span>
                </div>

                <div className={soon ? "domain-stat is-bad" : "domain-stat"}>
                  <span className="domain-stat-value">{soon}</span>
                  <span className="domain-stat-label">expiring within 30 days</span>
                </div>

                <div className={manual ? "domain-stat is-warn" : "domain-stat"}>
                  <span className="domain-stat-value">{manual}</span>
                  <span className="domain-stat-label">not on auto-renew</span>
                </div>
              </div>

              <div className="domain-bar">
                <input
                  type="search"
                  className="domain-search"
                  placeholder="Filter by name"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setVisible(PAGE);
                  }}
                />
                {/* What the filter left, when it left something different.
                    Silent otherwise, so the line only appears when it says
                    something the tiles above do not. */}
                {/* The four questions actually asked of this list, as one
                    control rather than four columns to eyeball. Each is a
                    filter somebody would otherwise apply by scrolling. */}
                <div className="seg seg-sm">
                  {(
                    [
                      ["all", "All"],
                      ["soon", "Expiring"],
                      ["manual", "Manual"],
                      ["parked", "Parked"],
                      ["trouble", "Trouble"],
                    ] as Array<[typeof only, string]>
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={only === key ? "seg-btn is-on" : "seg-btn"}
                      onClick={() => {
                        setOnly(key);
                        setVisible(PAGE);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Boxed, and split into parts with a rule between them. As a
                    run of grey text with a middle dot it read as a caption on
                    the search box; it is a result, and the two halves answer
                    two different questions. */}
                {shown.length !== domains.length ? (
                  <span className="domain-counts">
                    <span className="domain-count">
                      <strong>{shown.length}</strong> of {domains.length} shown
                    </span>
                    {shownYearly.totals.map(([currency, total]) => (
                      <span className="domain-count" key={currency}>
                        <strong>{money(total, currency)}</strong> a year
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>

              <table className="logs">
                <thead>
                  <tr>
                    {/* Every column sorts except the name servers themselves,
                        which have no order anyone would want: they are already
                        summarised by NS Points At, and sorting on the literal
                        hostname would group by whichever letter Cloudflare
                        happened to assign. */}
                    {(
                      [
                        ["domain", "Domain", false],
                        ["status", "Status", false],
                        ["expires", "Expires", false],
                        ["renewal", "Renewal", false],
                        ["price", "Renews for", true],
                        ["ns", "NS Points At", false],
                      ] as Array<[SortKey, string, boolean]>
                    ).map(([key, label, numeric]) => (
                      <th key={key} className={numeric ? "num sortable" : "sortable"}>
                        <button type="button" onClick={() => sortBy(key)}>
                          {label}
                          <Chevrons state={sortKey === key ? direction : "none"} />
                        </button>
                      </th>
                    ))}
                    <th>Name servers</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, visible).map((d) => {
                    const where = pointsAt(d.nameServers);
                    const price = prices[d.suffix];
                    return (
                      <tr key={d.domain}>
                        <td>
                          <a
                            className="domain-name"
                            href={`https://${d.domain}`}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            {d.domain}
                          </a>
                        </td>
                        <td>
                          <span className={`pill pill-${statusTone(d.status)}`}>
                            {prettyStatus(d.status)}
                          </span>
                        </td>
                        <td className="nowrap">
                          <span className={`pill pill-${expiryTone(d.daysLeft, d.renewAuto)}`}>
                            {expiryText(d.daysLeft, d.expires)}
                          </span>
                        </td>
                        <td className="nowrap">
                          {d.renewAuto ? (
                            <span className="quiet">automatic</span>
                          ) : (
                            <span className="pill pill-warn">manual</span>
                          )}
                        </td>
                        <td className="num">
                          {price?.renewal ? (
                            money(price.renewal, price.currency)
                          ) : (
                            <span className="quiet">not priced</span>
                          )}
                        </td>
                        <td className="detail">
                          <span className={`pill pill-${where.tone}`}>{where.label}</span>
                        </td>
                        {/* The names themselves, beside the summary rather than
                            instead of it. The pill answers "is this domain
                            live"; these answer "which record do I go and
                            change", which is the next thing you need and the
                            reason you would otherwise open GoDaddy. Every
                            domain on this account has exactly two, so the cell
                            is a predictable height. */}
                        <td className="ns">
                          {d.nameServers.length ? (
                            d.nameServers.map((ns) => (
                              <span className="ns-chip" key={ns}>
                                {ns}
                              </span>
                            ))
                          ) : (
                            <span className="quiet">none recorded</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {shown.length > visible ? (
                <div className="more">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setVisible((v) => v + PAGE)}
                  >
                    Show {Math.min(PAGE, shown.length - visible)} more
                  </button>
                </div>
              ) : null}

              {!shown.length ? (
                <div className="empty">
                  {query.trim()
                    ? `No domain matches “${query}”${only === "all" ? "" : " in this filter"}.`
                    : "Nothing in this filter."}
                </div>
              ) : null}

              <p className="domain-note">
                Prices are GoDaddy&rsquo;s published renewal rate for each
                extension, looked up once per extension and applied to every
                domain on it. They are not a quote for your account: a Discount
                Domain Club membership, a multi-year term or a premium name will
                all differ. GoDaddy does not publish what was originally paid,
                so that is not shown at all.
                {unpriced.length ? (
                  <>
                    {" "}
                    {unpriced.length} extension
                    {unpriced.length === 1 ? "" : "s"} could not be priced
                    because GoDaddy refuses a price check on{" "}
                    {unpriced.length === 1 ? "it" : "them"}:{" "}
                    {unpriced.map((s) => `.${s}`).join(", ")}.
                  </>
                ) : null}
                {scheme ? <> Read with the {scheme} authorization scheme.</> : null}
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
