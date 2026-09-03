"use client";

import { useCallback, useEffect, useState } from "react";

import type { AuditAction } from "@/lib/audit";

// The action type comes from the server rather than being copied here. The
// copy had drifted: "keys-updated" existed on the server and not in this list,
// so an entry for it rendered with no label and a pill class of
// "pill-undefined". Importing it means adding an action anywhere makes this
// file fail to compile until it has a label and a tone, which is the only way
// a table like this stays complete.
type AuditEvent = {
  at: string;
  actor: string;
  action: AuditAction;
  detail: string;
};

const LABEL: Record<AuditAction, string> = {
  "sign-in": "Signed in",
  "sign-in-failed": "Sign in failed",
  "sign-out": "Signed out",
  "run-started": "Started a run",
  "run-failed": "Run failed to start",
  "account-created": "Created an account",
  "run-canceled": "Cancelled a run",
  "run-cancel-failed": "Cancel failed",
  "run-retried": "Resumed a run",
  "run-retry-failed": "Resume failed",
  "site-saved": "Saved a site login",
  "site-removed": "Removed a site login",
  "keys-updated": "Changed engine credentials",
  "schedule-created": "Created a loop",
  "schedule-updated": "Changed a loop",
  "schedule-deleted": "Deleted a loop",
  "step-pinned": "Pinned a step",
  "step-unpinned": "Unpinned a step",
};

const TONE: Record<AuditAction, string> = {
  "sign-in": "ok",
  "sign-in-failed": "bad",
  "sign-out": "idle",
  "run-started": "run",
  "run-failed": "bad",
  "account-created": "run",
  "run-canceled": "idle",
  "run-cancel-failed": "bad",
  "run-retried": "run",
  "run-retry-failed": "bad",
  "site-saved": "run",
  "site-removed": "idle",
  "keys-updated": "warn",
  "schedule-created": "run",
  "schedule-updated": "run",
  "schedule-deleted": "idle",
  "step-pinned": "warn",
  "step-unpinned": "idle",
};

const PAGE = 25;

/**
 * The run a log line is about, or null.
 *
 * Mirrors executionIdFrom on the server. Several actions carry an id and the
 * last one in the line is the one meant: "Resumed execution #A as #B" is about
 * B, the run that now exists.
 */
function runIdOf(event: AuditEvent): string | null {
  if (!event.action.startsWith("run-")) return null;
  const found = event.detail.match(/#[\w-]+/g);
  if (!found?.length) return null;
  return found[found.length - 1]!.slice(1) || null;
}

/** Under a dollar reads better with cents; above it, they are noise. */
function money(value: number): string {
  return value < 10 ? `$${value.toFixed(2)}` : `$${Math.round(value)}`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

export default function LogsView() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [costs, setCosts] = useState<Record<string, number>>({});
  const [store, setStore] = useState<"redis" | "file" | "memory">("file");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const [filter, setFilter] = useState<"all" | "runs" | "auth">("all");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/logs", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!response.ok) throw new Error(`Logs API returned ${response.status}.`);
      const payload = (await response.json()) as {
        events: AuditEvent[];
        backend?: "redis" | "file" | "memory";
        costs?: Record<string, number>;
      };
      setEvents(payload.events ?? []);
      setCosts(payload.costs ?? {});
      setStore(payload.backend ?? "file");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the log.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [load]);

  /**
   * What this run cost.
   *
   * Blank when the line is not about a run at all — a sign-in has no price and
   * a dash in that column would only invite the question. A dash on a run means
   * there is no final cost yet: a run still going is never priced as though it
   * had finished, and one that failed to start never cost anything.
   */
  function costOf(event: AuditEvent): string {
    const id = runIdOf(event);
    if (!id) return "";
    const cost = costs[id];
    return cost === undefined ? "—" : money(cost);
  }

  const shown = events.filter((e) => {
    if (filter === "runs") return e.action.startsWith("run-");
    if (filter === "auth") return e.action.startsWith("sign-");
    return true;
  });

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Activity log</h2>
            <p>Who did what, newest first. Recorded by this app, not by n8n.</p>
          </div>
          <div className="seg">
            {(["all", "runs", "auth"] as const).map((key) => (
              <button
                key={key}
                type="button"
                className={filter === key ? "seg-btn is-on" : "seg-btn"}
                onClick={() => {
                  setFilter(key);
                  setVisible(PAGE);
                }}
              >
                {key === "all" ? "All" : key === "runs" ? "Runs" : "Sign in"}
              </button>
            ))}
          </div>
        </div>

        <div className="card-body tight">
          {store === "memory" ? (
            <div className="notice warn">
              <strong>History is not being kept.</strong> No KV store answered
              and the filesystem is read-only, so entries live in one server
              instance&rsquo;s memory and are gone when it recycles &mdash;
              which is why the log looks empty. Check that KV_REST_API_URL and
              KV_REST_API_TOKEN are set on the project and that the store is
              still running.
            </div>
          ) : null}

          {error ? <div className="notice bad">{error}</div> : null}

          {loading ? (
            <div className="empty">Loading…</div>
          ) : shown.length === 0 ? (
            <div className="empty">
              {filter === "all"
                ? "Nothing recorded yet. Sign in and out, or start a run, and it will appear here."
                : "Nothing in this category yet."}
            </div>
          ) : (
            <>
              <table className="logs">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Who</th>
                    <th>What</th>
                    <th>Detail</th>
                    <th className="num">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, visible).map((event, i) => (
                    <tr key={`${event.at}-${i}`}>
                      <td className="mono nowrap">{formatWhen(event.at)}</td>
                      <td>{event.actor}</td>
                      <td>
                        <span className={`pill pill-${TONE[event.action]}`}>
                          {LABEL[event.action] ?? event.action}
                        </span>
                      </td>
                      <td className="detail">{event.detail}</td>
                      <td className="num mono nowrap">{costOf(event)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {shown.length > visible ? (
                <button
                  type="button"
                  className="btn btn-ghost show-more"
                  onClick={() => setVisible((n) => n + PAGE)}
                >
                  Show more ({shown.length - visible} older)
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
