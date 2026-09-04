"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import DatePicker from "@/components/DatePicker";

type Site = {
  siteUrl: string;
  site: string;
  kind: string;
  permission: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  error: string | null;
};

type Payload = {
  sites: Site[];
  startDate: string;
  endDate: string;
  readingAs: string;
  accessKind: "signin" | "service";
};

type SortKey = "site" | "clicks" | "impressions" | "ctr" | "position";

/**
 * Which end of each column is the interesting one.
 *
 * Traffic reads largest first. Position is the exception and the one people get
 * wrong: a lower average position is a better one, so ascending is the good end.
 */
const FIRST: Record<SortKey, "asc" | "desc"> = {
  site: "asc",
  clicks: "desc",
  impressions: "desc",
  ctr: "desc",
  position: "asc",
};

const WINDOWS: Array<[number, string]> = [
  [7, "7 days"],
  [28, "28 days"],
  [90, "90 days"],
];

function whole(n: number): string {
  return new Intl.NumberFormat().format(Math.round(n));
}

function Chevrons({ state }: { state: "none" | "asc" | "desc" }) {
  return (
    <svg className={`sortmark is-${state}`} viewBox="0 0 10 14" aria-hidden>
      <path className="sortmark-up" d="M5 1.5 8.2 5.4H1.8z" />
      <path className="sortmark-down" d="M5 12.5 1.8 8.6h6.4z" />
    </svg>
  );
}

export default function PerformanceView() {
  const [data, setData] = useState<Payload | null>(null);
  const [days, setDays] = useState(28);
  /**
   * A window somebody chose, empty until they do.
   *
   * Kept apart from the preset rather than folded into it, so switching
   * back to 28 days and returning to Custom does not lose the dates.
   */
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState(false);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("clicks");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");

  // Named "span", not "window": a parameter called window shadows the global
  // one, and the redirect below then reads as nonsense rather than as a
  // redirect.
  const load = useCallback(async (span: number, range?: { from: string; to: string }) => {
    setLoading(true);
    try {
      const query = range?.from && range?.to
        ? `start=${range.from}&end=${range.to}`
        : `days=${span}`;
      const response = await fetch(`/api/performance?${query}`, { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) {
        setConfigError(payload.kind === "config");
        throw new Error(payload.error ?? `The performance API returned ${response.status}.`);
      }
      setData(payload);
      setConfigError(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach Search Console.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // A custom window only loads once both ends are chosen. Fetching on the
    // first of two dates would report a range nobody asked for and then
    // replace it a moment later.
    if (custom) {
      if (from && to) void load(days, { from, to });
      return;
    }
    void load(days);
  }, [load, days, custom, from, to]);

  function sortBy(key: SortKey) {
    if (key === sortKey) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection(FIRST[key]);
    }
  }

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = (data?.sites ?? []).filter(
      (s) => !needle || s.site.toLowerCase().includes(needle),
    );
    const flip = direction === "asc" ? 1 : -1;

    return [...rows].sort((a, b) => {
      if (sortKey === "site") return a.site.localeCompare(b.site) * flip;
      // A property with no data has position 0, which would otherwise sort as
      // the best on the page. It belongs at the bottom either way.
      if (sortKey === "position") {
        const pa = a.position || Number.POSITIVE_INFINITY;
        const pb = b.position || Number.POSITIVE_INFINITY;
        return (pa - pb) * flip || a.site.localeCompare(b.site);
      }
      return ((a[sortKey] as number) - (b[sortKey] as number)) * flip ||
        a.site.localeCompare(b.site);
    });
  }, [data, query, sortKey, direction]);

  // Over everything, not over what the search box left: these are facts about
  // the account and should not move as you type.
  const totals = useMemo(() => {
    const rows = data?.sites ?? [];
    const clicks = rows.reduce((n, s) => n + s.clicks, 0);
    const impressions = rows.reduce((n, s) => n + s.impressions, 0);
    return {
      clicks,
      impressions,
      // Computed from the totals rather than averaged from the rows. Averaging
      // a rate gives a small site the same weight as a large one, which is a
      // different number and not the one anybody means.
      ctr: impressions ? clicks / impressions : 0,
      silent: rows.filter((s) => !s.impressions && !s.error).length,
      broken: rows.filter((s) => s.error).length,
    };
  }, [data]);

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Performance</h2>
          </div>
          <div className="perf-window">
            <div className="seg seg-sm">
              {WINDOWS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={!custom && days === value ? "seg-btn is-on" : "seg-btn"}
                  onClick={() => {
                    setCustom(false);
                    setDays(value);
                  }}
                >
                  {label}
                </button>
              ))}
              <button
                type="button"
                className={custom ? "seg-btn is-on" : "seg-btn"}
                onClick={() => {
                  setCustom(true);
                  // Seeded from the window on screen, so Custom opens on the
                  // period being looked at rather than on nothing.
                  if (!from && data) setFrom(data.startDate);
                  if (!to && data) setTo(data.endDate);
                }}
              >
                Custom
              </button>
            </div>

            {custom ? (
              <div className="perf-dates">
                <DatePicker id="perf-from" value={from} onChange={setFrom} placeholder="from" />
                <span className="perf-dash" aria-hidden>
                  &ndash;
                </span>
                <DatePicker id="perf-to" value={to} onChange={setTo} placeholder="to" />
              </div>
            ) : null}
          </div>
        </div>

        <div className="card-body tight">
          {error ? (
            <div className="notice bad">
              {error}
              {configError ? (
                <>
                  {" "}
                  <a href="/keys">Open the Keys page</a> to fix it.
                </>
              ) : null}
            </div>
          ) : null}

          {/* The commonest way this comes back empty, and not an error: the
              account authenticated fine and has been added to nothing. */}
          {data && !data.sites.length && !error ? (
            <div className="notice warn">
              {/* Two different situations that look identical here, and only
                  one of them is fixed by adding a user to anything. */}
              {data.accessKind === "signin" ? (
                <>
                  <strong>
                    That Google account owns no Search Console properties.
                  </strong>{" "}
                  Signed in as <code>{data.readingAs}</code>. If your properties
                  belong to a different Google account, connect that one instead
                  on the Keys page.
                </>
              ) : (
                <>
                  <strong>This service account can see no properties.</strong>{" "}
                  Add <code>{data.readingAs}</code> as a user on each property in
                  Search Console, under Settings, Users and permissions. Or
                  connect a Google account on the Keys page, which sees every
                  property it owns without adding anything.
                </>
              )}
            </div>
          ) : null}

          {custom && !(from && to) ? (
            <div className="empty">Choose both ends of the period.</div>
          ) : null}

          {loading && !data ? <div className="empty">Loading…</div> : null}

          {data?.sites.length ? (
            <>
              <div className="domain-stats">
                <div className="domain-stat is-lead">
                  <span className="domain-stat-value">{whole(totals.clicks)}</span>
                  <span className="domain-stat-label">clicks</span>
                </div>
                <div className="domain-stat">
                  <span className="domain-stat-value">{whole(totals.impressions)}</span>
                  <span className="domain-stat-label">impressions</span>
                </div>
                <div className="domain-stat">
                  <span className="domain-stat-value">
                    {(totals.ctr * 100).toFixed(1)}%
                  </span>
                  <span className="domain-stat-label">click-through</span>
                </div>
                <div className={totals.silent ? "domain-stat is-warn" : "domain-stat"}>
                  <span className="domain-stat-value">{totals.silent}</span>
                  <span className="domain-stat-label">with no impressions</span>
                </div>
                {totals.broken ? (
                  <div className="domain-stat is-bad">
                    <span className="domain-stat-value">{totals.broken}</span>
                    <span className="domain-stat-label">could not be read</span>
                  </div>
                ) : null}
              </div>

              <div className="domain-bar">
                <input
                  type="search"
                  className="domain-search"
                  placeholder="Filter by name"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <span className="domain-counts">
                  <span className="domain-count">
                    <strong>{data.startDate}</strong> to {data.endDate}
                  </span>
                </span>
              </div>

              <table className="logs logs-middle">
                <thead>
                  <tr>
                    {(
                      [
                        ["site", "Site", ""],
                        ["clicks", "Clicks", "mid"],
                        ["impressions", "Impressions", "mid"],
                        ["ctr", "CTR", "mid"],
                        ["position", "Avg position", "mid"],
                      ] as Array<[SortKey, string, string]>
                    ).map(([key, label, align]) => (
                      <th key={key} className={align ? `${align} sortable` : "sortable"}>
                        <button type="button" onClick={() => sortBy(key)}>
                          {label}
                          <Chevrons state={sortKey === key ? direction : "none"} />
                        </button>
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((s) => (
                    <tr key={s.siteUrl}>
                      <td>
                        <a
                          className="domain-name"
                          href={`https://${s.site}`}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {s.site}
                        </a>
                      </td>
                      <td className="mid">{whole(s.clicks)}</td>
                      <td className="mid">{whole(s.impressions)}</td>
                      <td className="mid">
                        {s.impressions ? `${(s.ctr * 100).toFixed(1)}%` : <span className="quiet">—</span>}
                      </td>
                      <td className="mid">
                        {s.position ? s.position.toFixed(1) : <span className="quiet">—</span>}
                      </td>
                      <td className="detail">
                        {s.error ? (
                          <span className="pill pill-bad" title={s.error}>
                            could not be read
                          </span>
                        ) : (
                          <span className="registrar">
                            {s.kind === "domain" ? "domain property" : "url prefix"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p className="domain-note">
                Whole days in each property&rsquo;s own time zone, ending
                yesterday &mdash; today is always partial, and half a day beside
                twenty-seven whole ones makes every trend look like a collapse.
                A site with no impressions is not an error: it is a property
                Google has nothing to report for. Read as{" "}
                <code>{data.readingAs}</code>.
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
