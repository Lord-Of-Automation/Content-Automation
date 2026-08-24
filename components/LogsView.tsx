"use client";

import { useCallback, useEffect, useState } from "react";

type AuditEvent = {
  at: string;
  actor: string;
  action:
    | "sign-in"
    | "sign-in-failed"
    | "sign-out"
    | "run-started"
    | "run-failed"
    | "account-created"
    | "run-canceled"
    | "run-cancel-failed";
  detail: string;
};

const LABEL: Record<AuditEvent["action"], string> = {
  "sign-in": "Signed in",
  "sign-in-failed": "Sign in failed",
  "sign-out": "Signed out",
  "run-started": "Started a run",
  "run-failed": "Run failed to start",
  "account-created": "Created an account",
  "run-canceled": "Cancelled a run",
  "run-cancel-failed": "Cancel failed",
};

const TONE: Record<AuditEvent["action"], string> = {
  "sign-in": "ok",
  "sign-in-failed": "bad",
  "sign-out": "idle",
  "run-started": "run",
  "run-failed": "bad",
  "account-created": "run",
  "run-canceled": "idle",
  "run-cancel-failed": "bad",
};

const PAGE = 25;

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
      };
      setEvents(payload.events ?? []);
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
          <p className="logs-foot">
            Stored in{" "}
            {store === "redis"
              ? "a KV store, kept across deployments and restarts"
              : store === "file"
                ? "a file on this machine (.data/audit.jsonl)"
                : "memory only"}
            .
          </p>
        </div>
      </div>
    </div>
  );
}
