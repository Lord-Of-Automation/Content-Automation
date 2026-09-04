"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import AddToCloudflare from "@/components/AddToCloudflare";
import BulkBar from "@/components/BulkBar";
import DomainDns from "@/components/DomainDns";
import {
  orderDomains, pointsAt, statusTone, type Direction, type SortKey,
} from "@/lib/domainsort";

type Domain = {
  provider: string;
  providerLabel: string;
  domain: string;
  suffix: string;
  status: string;
  expires: string | null;
  daysLeft: number | null;
  renewAuto: boolean;
  nameServers: string[];
  /** Micro-units, as both registrars quote. 22990000 is 22.99. */
  renewalPrice: number | null;
  currency: string;
  cloudflare: "active" | "pending" | "elsewhere" | "none" | "unknown";
  cloudflareZoneId: string | null;
};

/**
 * The Cloudflare column, as a badge.
 *
 * A word rather than a coloured dot, because a dot needs a legend and this
 * table has no room for one. Four states and not two: Pending is a zone that
 * exists and is waiting for its name servers, which is a real thing that
 * happens for minutes to hours after adding, and Unknown is that Cloudflare
 * could not be asked at all. That last one is grey and never red, because
 * "we could not ask" and "Cloudflare does not have it" mean opposite things
 * and confusing them has people adding zones that already exist.
 */
const CLOUDFLARE_BADGE: Record<
  Domain["cloudflare"],
  { tone: string; label: string; text: string }
> = {
  active: { tone: "ok", label: "Active", text: "Active: Cloudflare has verified this zone." },
  pending: {
    tone: "warn",
    label: "Pending",
    text: "Added, but waiting for the name servers to change at the registrar.",
  },
  elsewhere: {
    tone: "run",
    label: "Other account",
    text:
      "This domain answers from Cloudflare name servers, so it is on Cloudflare — " +
      "just under an account the configured token cannot see.",
  },
  none: {
    tone: "bad",
    label: "Inactive",
    text: "Not on Cloudflare: no zone here, and its name servers point elsewhere.",
  },
  unknown: { tone: "idle", label: "Unknown", text: "Cloudflare could not be asked." },
};

/** How one registrar's read went, so the page can say what it is missing. */
type Source = {
  provider: string;
  label: string;
  ok: boolean;
  count: number;
  note: string;
  unpriced: string[];
};

/** Both registrars price in millionths. Rendered in the viewer's own locale. */
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
  provider: "asc",
  status: "asc",
  expires: "asc",
  renewal: "asc",
  price: "desc",
  ns: "asc",
  // Ascending puts what is not on Cloudflare first, which is the reason
  // somebody clicks this column.
  cloudflare: "asc",
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
  const [sources, setSources] = useState<Source[]>([]);
  /** The domain whose DNS panel is open, or null. */
  const [managing, setManaging] = useState<Domain | null>(null);
  /** The domain being added to Cloudflare, or null. */
  const [adding, setAdding] = useState<Domain | null>(null);
  /**
   * The domains ticked, by name.
   *
   * Names rather than rows, so a selection survives a re-sort, a filter change
   * and a reload. Ticking a domain and then narrowing the filter should not
   * quietly drop it from what a bulk action is about to touch.
   */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [cfNote, setCfNote] = useState<{ ok: boolean; zones: number; note: string } | null>(null);
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
      setSources(payload.sources ?? []);
      setCfNote(payload.cloudflare ?? null);
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
    /**
     * Ask Cloudflare about anything still pending.
     *
     * This app has no background worker, so the sweep rides on the page being
     * opened. It enforces its own five-minute interval and its own one-hour
     * window internally, so calling it on every load is cheap and calling it
     * twice in a minute does one round of checks. A zone that activates while
     * nobody is looking is still picked up: the column asks Cloudflare directly
     * on the next load either way.
     */
    void fetch("/api/cloudflare?sweep=1", { cache: "no-store" }).catch(() => {});
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

    return orderDomains(kept, sortKey, direction);
  }, [domains, query, only, sortKey, direction]);

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
        if (!d.renewalPrice) continue;
        totals.set(d.currency, (totals.get(d.currency) ?? 0) + d.renewalPrice);
        counted += 1;
      }
      return { totals: [...totals.entries()], counted };
    },
    [],
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

          {/* Only when something is wrong or worth acting on. A registrar that
              failed must not empty the page or hide the other one's domains, so
              it says so here and the rest of the list stands. A registrar that
              read fine says nothing: the count is already in the strip above,
              and a banner confirming that things worked is a banner people stop
              reading. */}
          {cfNote && !cfNote.ok ? (
            <div className="notice warn">
              <strong>Cloudflare could not be read.</strong> {cfNote.note} Every
              row shows Unknown until it can be, which is not the same as saying
              those domains are not on Cloudflare. Adding one still works; it
              will simply be Cloudflare that answers.
            </div>
          ) : null}

          {sources
            .filter((s) => !s.ok || (s.note && s.note !== "read" && s.note !== "no credential set"))
            .map((s) => (
              <div className={s.ok ? "notice" : "notice bad"} key={s.provider}>
                <strong>{s.label}:</strong> {s.note}
                {s.ok && s.count ? ` (${s.count} domains)` : null}
              </div>
            ))}
          {loading && !domains.length ? (
            <div className="empty">Loading…</div>
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
                    {/* Select-all covers what the filter left, not the whole
                        estate. Ticking a box while looking at five domains and
                        acting on three hundred is not something anybody means
                        to do. */}
                    <th className="pick">
                      <input
                        type="checkbox"
                        aria-label="Select every domain shown"
                        checked={shown.length > 0 && shown.every((d) => picked.has(d.domain))}
                        ref={(el) => {
                          if (el) {
                            el.indeterminate =
                              shown.some((d) => picked.has(d.domain)) &&
                              !shown.every((d) => picked.has(d.domain));
                          }
                        }}
                        onChange={(e) =>
                          setPicked((current) => {
                            const next = new Set(current);
                            for (const d of shown) {
                              if (e.target.checked) next.add(d.domain);
                              else next.delete(d.domain);
                            }
                            return next;
                          })
                        }
                      />
                    </th>
                    {(
                      [
                        ["domain", "Domain", false],
                        ["provider", "Registrar", false],
                        ["status", "Status", false],
                        ["expires", "Expires", false],
                        ["renewal", "Renewal", false],
                        ["price", "Renews for", true],
                        ["ns", "Name servers", false],
                        ["cloudflare", "Cloudflare", false],
                      ] as Array<[SortKey, string, boolean]>
                    ).map(([key, label, numeric]) => (
                      <th key={key} className={numeric ? "num sortable" : "sortable"}>
                        <button type="button" onClick={() => sortBy(key)}>
                          {label}
                          <Chevrons state={sortKey === key ? direction : "none"} />
                        </button>
                      </th>
                    ))}
                    <th />
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, visible).map((d) => {
                    const where = pointsAt(d.nameServers);
                    return (
                      <tr key={d.domain} className={picked.has(d.domain) ? "is-picked" : ""}>
                        <td className="pick">
                          <input
                            type="checkbox"
                            aria-label={`Select ${d.domain}`}
                            checked={picked.has(d.domain)}
                            onChange={(e) =>
                              setPicked((current) => {
                                const next = new Set(current);
                                if (e.target.checked) next.add(d.domain);
                                else next.delete(d.domain);
                                return next;
                              })
                            }
                          />
                        </td>
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
                          <span className="registrar">{d.providerLabel}</span>
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
                          {d.renewalPrice ? (
                            money(d.renewalPrice, d.currency)
                          ) : (
                            <span className="quiet">not priced</span>
                          )}
                        </td>
                        {/* One column, because it is one fact. The pill is
                            the answer at a glance — Cloudflare, or parked and
                            doing nothing — and the hosts beneath it are which
                            record to go and change. Split across two columns
                            they made the table wider to say the same thing
                            twice. */}
                        <td className="ns">
                          {/* Stacked inside the cell rather than by making the
                              cell a flex container. A flex <td> leaves the
                              table's layout, so it stops sharing the row's
                              height and every other column stops lining up
                              with it. */}
                          <div className="ns-stack">
                            <span className={`pill pill-${where.tone}`}>{where.label}</span>
                            {d.nameServers.length ? (
                              d.nameServers.map((ns) => (
                                <span className="ns-chip" key={ns}>
                                  {ns}
                                </span>
                              ))
                            ) : (
                              <span className="quiet">none recorded</span>
                            )}
                          </div>
                        </td>
                        <td className="nowrap">
                          <span
                            className={`pill pill-${CLOUDFLARE_BADGE[d.cloudflare].tone}`}
                            title={CLOUDFLARE_BADGE[d.cloudflare].text}
                          >
                            {CLOUDFLARE_BADGE[d.cloudflare].label}
                          </span>
                        </td>
                        <td className="row-actions">
                          {/* Greyed only when the domain really is on
                              Cloudflare. It used to be greyed for Unknown too,
                              which meant that a token this console could not
                              read made every button on the page unclickable —
                              including for the domains that most needed adding.
                              Not knowing is a reason to let somebody try, not a
                              reason to stop them: the attempt either works or
                              comes back with Cloudflare's own answer, and both
                              beat a button that will not press. */}
                          <button
                            type="button"
                            className="btn btn-cloudflare btn-sm"
                            disabled={
                              d.cloudflare === "active" ||
                              d.cloudflare === "pending" ||
                              d.cloudflare === "elsewhere"
                            }
                            title={
                              d.cloudflare === "none" || d.cloudflare === "unknown"
                                ? `Create a Cloudflare zone for ${d.domain}`
                                : CLOUDFLARE_BADGE[d.cloudflare].text
                            }
                            onClick={() => setAdding(d)}
                          >
                            Add to Cloudflare
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setManaging(d)}
                          >
                            Modify
                          </button>
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
                Prices are each registrar&rsquo;s published renewal rate for the
                extension, looked up once per extension and applied to every
                domain on it. They are not a quote for your account: a discount
                club membership, a multi-year term or a premium name will all
                differ. Neither registrar publishes what was originally paid, so
                that is not shown at all.
                {sources
                  .filter((s) => s.unpriced.length)
                  .map((s) => (
                    <span key={s.provider}>
                      {" "}
                      {s.label} would not price{" "}
                      {s.unpriced.map((x) => `.${x}`).join(", ")}.
                    </span>
                  ))}
              </p>            </>
          ) : null}
        </div>
      </div>
      {/* Only for domains still on screen. A bulk action that included rows
          the filter has hidden would act on things nobody can see. */}
      {picked.size ? (
        <BulkBar
          targets={domains
            .filter((d) => picked.has(d.domain))
            .map((d) => ({ domain: d.domain, provider: d.provider }))}
          onClear={() => setPicked(new Set())}
          onDone={() => void load()}
        />
      ) : null}

      {adding ? (
        <AddToCloudflare
          domain={adding.domain}
          provider={adding.provider}
          onClose={() => setAdding(null)}
          onDone={() => {
            setAdding(null);
            void load();
          }}
        />
      ) : null}

      {managing ? (
        <DomainDns
          domain={managing.domain}
          provider={managing.provider}
          onClose={() => {
            setManaging(null);
            // The name servers may have moved, and this list shows them.
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
