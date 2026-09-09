"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import StatusBadge from "@/components/StatusBadge";
import { SkeletonBar, SkeletonStack, SkeletonStatCells } from "@/components/Skeleton";
import { formatWhen } from "@/lib/format";
import type { Overview, OverviewLoop, OverviewRun, OverviewSite } from "@/lib/overview";

/**
 * The front door.
 *
 * Signing in used to drop you on Optimize, which is a form for starting work.
 * The question anybody actually arrives with is the opposite one: what
 * happened without me. Did last night's loops fire, did anything fail, what is
 * due next, what has this cost.
 *
 * So the page is ordered by what changes a decision. Anything broken comes
 * first, because it is the only part of this that asks something of you. Then
 * the figures, then what ran, what is due, and what went live. Nothing here is
 * a control: every row is a way into the page that owns it.
 *
 * Money arrives on a second request. Pricing walks a full payload per run and
 * is the slowest call in the console; making the front door wait for it would
 * undo the point of having one.
 */

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

type Spend = {
  total: number;
  byMonth: { month: string; total: number; runs: number }[];
};

function money(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function age(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const at = new Date(iso).getTime();
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : Date.now() - at;
}

/**
 * How long until something, in the words someone would use.
 *
 * formatWhen answers the past and reads "in 3 hours" as "-180m ago" for the
 * future, which is the wrong half of the line for a schedule.
 */
function until(iso: string | null): string {
  if (!iso) return "—";
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return "—";

  const mins = Math.round((at - Date.now()) / 60000);
  if (mins <= 0) return "due now";
  if (mins < 60) return `in ${mins}m`;
  if (mins < 60 * 24) return `in ${Math.round(mins / 60)}h`;
  return `in ${Math.round(mins / (60 * 24))}d`;
}

/** The address without the parts nobody reads out loud. */
function host(url: string | null): string {
  if (!url) return "—";
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function isFailure(status: OverviewRun["status"]): boolean {
  return status === "error" || status === "crashed";
}

function isRunning(status: OverviewRun["status"]): boolean {
  return status === "running" || status === "new" || status === "waiting";
}

/** A figure with its caption, in the tiles above the fold. */
function Stat({
  value,
  label,
  tone,
  lead,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  tone?: "bad" | "warn";
  lead?: boolean;
}) {
  const classes = ["domain-stat"];
  if (lead) classes.push("is-lead");
  if (tone) classes.push(`is-${tone}`);

  return (
    <div className={classes.join(" ")}>
      <span className="domain-stat-value">{value}</span>
      <span className="domain-stat-label">{label}</span>
    </div>
  );
}

export default function Overview() {
  const [data, setData] = useState<Overview | null>(null);
  const [spend, setSpend] = useState<Spend | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/overview", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not read the overview.");
      setData(payload as Overview);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the overview.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * The month's spend, fetched apart from everything else and allowed to fail
   * quietly. A number that could not be priced is a missing number, not a
   * broken page, and it is the one thing here nobody acts on immediately.
   */
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch("/api/spend?limit=25", { cache: "no-store" });
        if (!response.ok) return;
        const payload = (await response.json()) as Spend;
        if (live) setSpend(payload);
      } catch {
        // Left blank rather than explained. The Logs page reports it properly.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  /*
   * A run still going is polled for, because the front door is a page people
   * leave open. Once nothing is in flight the timer stops paying for itself,
   * so it stops.
   */
  const busy = data?.runs.some((r) => isRunning(r.status)) ?? false;
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(timer);
  }, [busy, load]);

  const runs = data?.runs ?? [];

  const recent = useMemo(() => runs.filter((r) => age(r.startedAt) < DAY), [runs]);
  const running = useMemo(() => runs.filter((r) => isRunning(r.status)), [runs]);
  const failed = useMemo(
    () => runs.filter((r) => isFailure(r.status) && age(r.startedAt) < WEEK),
    [runs],
  );

  const due = useMemo(
    () =>
      (data?.loops ?? [])
        .filter((l) => l.enabled)
        .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt))
        .slice(0, 5),
    [data],
  );

  const published = useMemo(
    () =>
      (data?.sites ?? [])
        .filter((s): s is OverviewSite & { published: NonNullable<OverviewSite["published"]> } =>
          Boolean(s.published),
        )
        .sort((a, b) => b.published.at.localeCompare(a.published.at))
        .slice(0, 5),
    [data],
  );

  const brokenSites = useMemo(
    () => (data?.sites ?? []).filter((s) => s.status === "failed"),
    [data],
  );

  const thisMonth = useMemo(() => {
    if (!spend) return null;
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return spend.byMonth.find((m) => m.month === key) ?? null;
  }, [spend]);

  const attention = failed.length + brokenSites.length;

  return (
    <>
      {error ? <div className="notice bad">{error}</div> : null}

      {data?.notes.runs ? (
        <div className="notice bad">
          <strong>The engine could not be reached.</strong> {data.notes.runs}
        </div>
      ) : null}

      {/* Four figures, in the order somebody scans them: what needs doing,
          what is happening, what is coming, what it costs. */}
      <div className="domain-stats ov-stats">
        {loading ? (
          <SkeletonStatCells count={4} />
        ) : (
          <>
            <Stat
              lead
              tone={attention ? "bad" : undefined}
              value={attention || "All clear"}
              label={attention ? "needing a look" : "nothing failed this week"}
            />
            <Stat
              value={running.length}
              label={`running now${recent.length ? ` · ${recent.length} today` : ""}`}
            />
            <Stat
              value={due.length ? until(due[0]!.nextRunAt).replace("in ", "") : "—"}
              label={due.length ? `until ${due[0]!.name}` : "no loops scheduled"}
            />
            <Stat
              value={
                thisMonth ? (
                  money(thisMonth.total)
                ) : spend ? (
                  "$0"
                ) : (
                  <SkeletonBar w="70%" />
                )
              }
              label="spent this month"
            />
          </>
        )}
      </div>

      {/* Only when there is something. A permanent card reading "nothing is
          wrong" is a card people stop reading, and then it is not there when
          it says something. */}
      {attention ? (
        <div className="card ov-attention">
          <div className="card-head">
            <div>
              <h2>Needs a look</h2>
              <p>Failures from the past week, and websites that were never written.</p>
            </div>
          </div>
          <div className="card-body tight">
            <ul className="ov-list">
              {failed.map((run) => (
                <li key={run.id}>
                  <Link className="ov-row" href={`/runs?run=${encodeURIComponent(run.id)}`}>
                    <span className="ov-row-main">
                      <strong>{host(run.website) || run.id}</strong>
                      <span className="ov-row-sub">
                        {run.by ? `started by ${run.by} · ` : null}
                        {formatWhen(run.startedAt)}
                      </span>
                    </span>
                    <StatusBadge status={run.status} />
                  </Link>
                </li>
              ))}
              {brokenSites.map((site) => (
                <li key={site.id}>
                  <Link className="ov-row" href={`/websites/${site.id}`}>
                    <span className="ov-row-main">
                      <strong>{site.name}</strong>
                      <span className="ov-row-sub">
                        {site.note || "The run ended without writing any pages."}
                      </span>
                    </span>
                    <span className="pill pill-bad">Failed</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="ov-grid">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Runs</h2>
              <p>Everything the engine has done in the last day.</p>
            </div>
            <Link className="btn btn-ghost" href="/runs">
              Optimize
            </Link>
          </div>
          <div className="card-body tight">
            {loading ? (
              <SkeletonStack count={4} />
            ) : !recent.length && !running.length ? (
              <div className="empty">
                Nothing has run since yesterday. Start one on Optimize, or set a
                loop to have it done without asking.
              </div>
            ) : (
              <ul className="ov-list">
                {[...running, ...recent.filter((r) => !isRunning(r.status))].map((run) => (
                  <li key={run.id}>
                    <Link className="ov-row" href={`/runs?run=${encodeURIComponent(run.id)}`}>
                      <span className="ov-row-main">
                        <strong>{host(run.website) || run.id}</strong>
                        <span className="ov-row-sub">
                          {run.by ? `${run.by} · ` : null}
                          {formatWhen(run.startedAt)}
                        </span>
                      </span>
                      <StatusBadge status={run.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="ov-side">
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Due next</h2>
                <p>Loops that will fire without being asked.</p>
              </div>
              <Link className="btn btn-ghost" href="/loop">
                Loop
              </Link>
            </div>
            <div className="card-body tight">
              {loading ? (
                <SkeletonStack count={3} />
              ) : data?.notes.loops ? (
                <div className="notice bad">{data.notes.loops}</div>
              ) : !due.length ? (
                <div className="empty">
                  No loop is switched on. A loop is this work happening on a
                  Monday morning without you being there for it.
                </div>
              ) : (
                <ul className="ov-list">
                  {due.map((loop: OverviewLoop) => (
                    <li key={loop.id}>
                      <Link className="ov-row" href="/loop">
                        <span className="ov-row-main">
                          <strong>{loop.name}</strong>
                          <span className="ov-row-sub">
                            {host(loop.website)}
                            {loop.mode === "gap" ? " · game gap filler" : ""}
                          </span>
                        </span>
                        <span className="ov-when">{until(loop.nextRunAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Published</h2>
                <p>Generated websites, and where each one went.</p>
              </div>
              <Link className="btn btn-ghost" href="/websites">
                Websites
              </Link>
            </div>
            <div className="card-body tight">
              {loading ? (
                <SkeletonStack count={3} />
              ) : !published.length ? (
                <div className="empty">
                  Nothing has been published yet. A website is written here and
                  then put on one of your WordPress sites.
                </div>
              ) : (
                <ul className="ov-list">
                  {published.map((site) => (
                    <li key={site.id}>
                      <Link className="ov-row" href={`/websites/${site.id}`}>
                        <span className="ov-row-main">
                          <strong>{site.name}</strong>
                          <span className="ov-row-sub">
                            {host(site.published.address)} · {formatWhen(site.published.at)}
                          </span>
                        </span>
                        {/* Drafts are the default, so saying which is not a
                            detail: a site published as drafts is not yet a
                            site anybody can see. */}
                        <span className={site.published.live ? "pill pill-ok" : "pill pill-idle"}>
                          {site.published.live ? "Live" : "Draft"}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
