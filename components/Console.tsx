"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import RunForm, { type RunValues } from "@/components/RunForm";
import RunProgress from "@/components/RunProgress";
import StatusBadge from "@/components/StatusBadge";
import { formatDuration, formatWhen } from "@/lib/format";
import type { ExecutionDetail, ExecutionSummary, N8nStatus } from "@/lib/n8n";

const SELECTED_KEY = "ca:selected";
const DETAIL_POLL = 4_000;
const HISTORY_POLL = 15_000;
const RESOLVE_POLL = 5_000;
const RESOLVE_TIMEOUT = 3 * 60_000;

// Local copy so the client bundle does not pull in the whole n8n module.
function isTerminal(status: N8nStatus | undefined): boolean {
  return (
    status === "success" ||
    status === "error" ||
    status === "crashed" ||
    status === "canceled"
  );
}

type Pending = { startedAt: string; since: number };

export default function Console() {
  const [history, setHistory] = useState<ExecutionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);
  const [n8nUrl, setN8nUrl] = useState<string | null>(null);

  const [starting, setStarting] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // A run we started but could not get an execution id for, so we hunt for it.
  const pending = useRef<Pending | null>(null);

  // ------------------------------------------------------------- data loads

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch("/api/runs", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load runs.");
      setHistory(payload.executions ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach n8n.");
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/runs/${id}`, { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load run.");
      setDetail(payload.execution);
      setN8nUrl(payload.n8nUrl ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach n8n.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const selectRun = useCallback(
    (id: string) => {
      setSelectedId(id);
      setDetail(null);
      try {
        window.localStorage.setItem(SELECTED_KEY, id);
      } catch {
        /* private mode, cleared storage — not worth surfacing */
      }
      void loadDetail(id);
    },
    [loadDetail]
  );

  /** Only runs when the trigger handed back no execution id. */
  const resolvePending = useCallback(async () => {
    const job = pending.current;
    if (!job) return;

    if (Date.now() - job.since > RESOLVE_TIMEOUT) {
      pending.current = null;
      setNotice(
        "Could not match that run to an execution. Check n8n directly, it may still be going."
      );
      return;
    }

    try {
      const response = await fetch("/api/runs/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startedAt: job.startedAt }),
      });
      if (!response.ok) return;

      const payload = (await response.json()) as {
        execution: ExecutionSummary | null;
      };

      if (payload.execution) {
        pending.current = null;
        setNotice(null);
        selectRun(payload.execution.id);
      }
    } catch {
      /* keep trying until the timeout */
    }
  }, [selectRun]);

  // ------------------------------------------------------------- lifecycle

  useEffect(() => {
    void loadHistory();

    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(SELECTED_KEY);
    } catch {
      saved = null;
    }

    if (saved) {
      setSelectedId(saved);
      void loadDetail(saved);
    }
  }, [loadHistory, loadDetail]);

  useEffect(() => {
    const timer = window.setInterval(() => void loadHistory(), HISTORY_POLL);
    return () => window.clearInterval(timer);
  }, [loadHistory]);

  // Poll the selected run while it is in flight. Depending on the status
  // string rather than the object keeps the interval from resetting on every
  // successful poll.
  const selectedStatus = detail?.status;
  useEffect(() => {
    if (!selectedId) return;
    if (isTerminal(selectedStatus)) return;

    const timer = window.setInterval(
      () => void loadDetail(selectedId),
      DETAIL_POLL
    );
    return () => window.clearInterval(timer);
  }, [selectedId, selectedStatus, loadDetail]);

  useEffect(() => {
    const timer = window.setInterval(() => void resolvePending(), RESOLVE_POLL);
    return () => window.clearInterval(timer);
  }, [resolvePending]);

  // ------------------------------------------------------------- actions

  async function startRun(values: RunValues) {
    setStarting(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });

      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }

      const payload = await response.json();

      if (!response.ok) {
        if (payload.fieldErrors) setFieldErrors(payload.fieldErrors);
        throw new Error(payload.error ?? "Could not start the run.");
      }

      if (payload.executionId) {
        selectRun(String(payload.executionId));
      } else {
        pending.current = { startedAt: payload.startedAt, since: Date.now() };
        setNotice(
          payload.note ?? "Run started. Waiting for n8n to report the execution…"
        );
        void resolvePending();
      }

      void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the run.");
    } finally {
      setStarting(false);
    }
  }

  // ------------------------------------------------------------- render

  return (
    <div className="grid">
      <div>
        <div className="card">
          <div className="card-head">
            <div>
              <h2>New run</h2>
              <p>Crawl, research, rewrite and publish one page or a whole site.</p>
            </div>
          </div>
          <div className="card-body">
            {error ? (
              <div className="alert alert-bad" role="alert">
                {error}
              </div>
            ) : null}
            {notice ? <div className="alert alert-warn">{notice}</div> : null}

            <RunForm
              busy={starting}
              fieldErrors={fieldErrors}
              onSubmit={startRun}
            />
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2>Recent runs</h2>
              <p>Newest first, straight from the n8n execution log.</p>
            </div>
          </div>
          <div className="card-body tight">
            {history.length === 0 ? (
              <div className="empty">No executions yet.</div>
            ) : (
              <ul className="runs">
                {history.map((run) => (
                  <li key={run.id}>
                    <button
                      type="button"
                      className="run"
                      aria-current={run.id === selectedId}
                      onClick={() => selectRun(run.id)}
                    >
                      <span className="run-id">#{run.id}</span>
                      <span className="run-meta">
                        {formatWhen(run.startedAt)} ·{" "}
                        {formatDuration(run.startedAt, run.stoppedAt)}
                      </span>
                      <StatusBadge status={run.status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>{selectedId ? `Run #${selectedId}` : "Progress"}</h2>
            <p>Stages are inferred from the nodes n8n has actually executed.</p>
          </div>
        </div>
        <RunProgress
          execution={detail}
          n8nUrl={n8nUrl}
          loading={detailLoading}
        />
      </div>
    </div>
  );
}
