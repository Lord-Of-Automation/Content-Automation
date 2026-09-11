"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useReveal } from "@/lib/reveal";
import { useGlide } from "@/lib/glide";
import Tally from "@/components/Tally";

import DatePicker from "@/components/DatePicker";
import { Select } from "@/components/Select";
import { ColumnPicker, useColumns, type ColumnSpec } from "@/components/Columns";
import { SkeletonTable } from "@/components/Skeleton";

/**
 * The columns, and which may be turned off.
 *
 * The site stays, and so does the last column, which holds the link out to
 * Search Console itself. The four figures are what somebody is here for on any
 * one visit, and rarely all four: a check on traffic is clicks, and a check on
 * how a page is doing in the results is position.
 */
const COLUMNS: ColumnSpec[] = [
  { key: "site", label: "Site", fixed: true },
  { key: "clicks", label: "Clicks" },
  { key: "impressions", label: "Impressions" },
  { key: "ctr", label: "CTR" },
  { key: "position", label: "Avg position" },
];

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
  errorKind: "none" | "unverified" | "rate-limited" | "no-access" | "failed";
};

/**
 * What to put in the badge, per reason.
 *
 * They were all "could not be read", which is true of each and useful about
 * none. Only one of them is something to chase.
 */
const TROUBLE: Record<Site["errorKind"], { label: string; tone: string } | null> = {
  none: null,
  unverified: { label: "not verified", tone: "warn" },
  "rate-limited": { label: "rate limited", tone: "warn" },
  "no-access": { label: "no access", tone: "bad" },
  failed: { label: "could not be read", tone: "bad" },
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

/** Fifty at a time, matching the Domains and Logs tables. */
const PAGE = 50;

function whole(n: number): string {
  return new Intl.NumberFormat().format(Math.round(n));
}

/** A share, as the page has always written one. */
function share(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** An average position, to one place. */
function place(n: number): string {
  return n.toFixed(1);
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
  const columns = useColumns("performance", COLUMNS);
  const [error, setError] = useState<string | null>(null);
  const [configError, setConfigError] = useState(false);
  const [query, setQuery] = useState("");
  /**
   * Which kind of property to show.
   *
   * Google treats these as different things and so should this page. A
   * domain property covers every subdomain and both protocols; a URL prefix
   * covers one address and nothing under it. An estate holding both counts
   * some traffic twice, and being able to look at one kind at a time is the
   * only way to see which.
   */
  const [kind, setKind] = useState<"" | "domain" | "prefix">("");
  const [sortKey, setSortKey] = useState<SortKey>("clicks");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [visible, setVisible] = useState(PAGE);
  // Rows travel to their new places when the sort changes, rather than
  // every one of them being somewhere else in a single frame.
  const glide = useGlide<HTMLTableSectionElement>();

  // Where a row revealed by Show more takes its arrival from, so a batch
  // cascades instead of landing all at once.
  const revealed = useReveal(visible);

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


  // Back to the first page whenever the list underneath changes. Holding
  // position while the filter narrows leaves you looking at rows that are no
  // longer there, or at nothing at all.
  useEffect(() => {
    setVisible(PAGE);
  }, [query, kind, sortKey, direction, data]);

  function sortBy(key: SortKey) {
    glide.capture();
    if (key === sortKey) setDirection((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setDirection(FIRST[key]);
    }
  }

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = (data?.sites ?? []).filter((s) => {
      if (kind && s.kind !== kind) return false;
      return !needle || s.site.toLowerCase().includes(needle);
    });
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
  }, [data, query, kind, sortKey, direction]);

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
      unverified: rows.filter((s) => s.errorKind === "unverified").length,
      limited: rows.filter((s) => s.errorKind === "rate-limited").length,
    };
  }, [data]);

  const kinds = useMemo(() => {
    const rows = data?.sites ?? [];
    return {
      all: rows.length,
      domain: rows.filter((s) => s.kind === "domain").length,
      prefix: rows.filter((s) => s.kind !== "domain").length,
    };
  }, [data]);

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Search Console</h2>
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

          {loading && !data ? <SkeletonTable columns={6} rows={8} /> : null}

          {data?.sites.length ? (
            <>
              <div className="domain-stats">
                {/* Counted rather than swapped. Changing the range rewrites
                    every figure here at once, and which way each one moved is
                    the whole question somebody changing it is asking. */}
                <div className="domain-stat is-lead">
                  <span className="domain-stat-value">
                    <Tally value={totals.clicks} format={whole} />
                  </span>
                  <span className="domain-stat-label">clicks</span>
                </div>
                <div className="domain-stat">
                  <span className="domain-stat-value">
                    <Tally value={totals.impressions} format={whole} />
                  </span>
                  <span className="domain-stat-label">impressions</span>
                </div>
                <div className="domain-stat">
                  <span className="domain-stat-value">
                    <Tally value={totals.ctr} format={share} />
                  </span>
                  <span className="domain-stat-label">click-through</span>
                </div>
                <div className={totals.silent ? "domain-stat is-warn" : "domain-stat"}>
                  <span className="domain-stat-value">
                    <Tally value={totals.silent} format={whole} />
                  </span>
                  <span className="domain-stat-label">with no impressions</span>
                </div>
                {totals.broken ? (
                  <div className="domain-stat is-bad">
                    <span className="domain-stat-value">{totals.broken}</span>
                    <span className="domain-stat-label">
                      {/* Named, because the fix differs. Unverified needs
                          access granting; rate limited needs waiting. */}
                      {totals.unverified === totals.broken
                        ? "not verified for this account"
                        : totals.limited === totals.broken
                          ? "rate limited, try again shortly"
                          : "could not be read"}
                    </span>
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
                <div className="bar-filter">
                  <Select
                    id="perf-kind"
                    value={kind}
                    onChange={(v) => setKind(v as "" | "domain" | "prefix")}
                    options={[
                      { value: "", label: "All properties", hint: `${kinds.all}` },
                      { value: "domain", label: "Domain properties", hint: `${kinds.domain}` },
                      { value: "prefix", label: "URL prefixes", hint: `${kinds.prefix}` },
                    ]}
                  />
                </div>
                <ColumnPicker specs={COLUMNS} chosen={columns} />

                <span className="domain-counts">
                  <span className="domain-count">
                    <strong>{data.startDate}</strong> to {data.endDate}
                  </span>
                </span>
              </div>

              <table className="logs logs-middle table-in">
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
                    )
                      .filter(([key]) => columns.shown(key))
                      .map(([key, label, align]) => (
                        <th key={key} className={columns.cell(key, align ? `${align} sortable` : "sortable")}>
                          <button type="button" onClick={() => sortBy(key)}>
                            {label}
                            <Chevrons state={sortKey === key ? direction : "none"} />
                          </button>
                        </th>
                      ))}
                    <th />
                  </tr>
                </thead>
                {/* Keyed on the filter so changing it replaces the rows
                    rather than editing them, which is what lets them arrive
                    again. Deliberately not keyed on the search box: rows that
                    re-animated on every keystroke would be unreadable while
                    being typed at. */}
                <tbody key={kind || "all"} ref={glide.ref}>
                  {shown.slice(0, visible).map((s, at) => (
                    <tr key={s.siteUrl} data-glide={s.siteUrl} style={revealed(at)}>
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
                      {columns.shown("clicks") ? (
                        <td className={columns.cell("clicks", "mid")}>
                          <Tally value={s.clicks} format={whole} />
                        </td>
                      ) : null}
                      {columns.shown("impressions") ? (
                        <td className={columns.cell("impressions", "mid")}>
                          <Tally value={s.impressions} format={whole} />
                        </td>
                      ) : null}
                      {columns.shown("ctr") ? (
                        <td className={columns.cell("ctr", "mid")}>
                          {s.impressions ? (
                            <Tally value={s.ctr} format={share} />
                          ) : (
                            <span className="quiet">—</span>
                          )}
                        </td>
                      ) : null}
                      {columns.shown("position") ? (
                        <td className={columns.cell("position", "mid")}>
                          {s.position ? (
                            <Tally value={s.position} format={place} />
                          ) : (
                            <span className="quiet">—</span>
                          )}
                        </td>
                      ) : null}
                      <td className="detail">
                        {s.error && TROUBLE[s.errorKind] ? (
                          <>
                            <span
                              className={`pill pill-${TROUBLE[s.errorKind]!.tone}`}
                              title={s.error}
                            >
                              {TROUBLE[s.errorKind]!.label}
                            </span>
                            {/* On screen rather than behind a hover, for the
                                one kind that has no known fix. Whatever Google
                                said is the only lead there is. */}
                            {s.errorKind === "failed" ? (
                              <div className="perf-why">{s.error}</div>
                            ) : null}
                          </>
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

              {/* A filter that matches nothing should say so. An empty table
                  under a full set of headings reads as a failed load. */}
              {!shown.length ? (
                <div className="empty">
                  {query.trim()
                    ? `No property matches “${query}”${kind ? " in this kind" : ""}.`
                    : kind === "domain"
                      ? "No domain properties on this account."
                      : "No URL prefix properties on this account."}
                </div>
              ) : null}

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

              <p className="domain-note">
                Read as <code>{data.readingAs}</code>.
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
