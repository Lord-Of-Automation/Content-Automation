"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import RunForm, { type RunValues } from "@/components/RunForm";
import RunProgress from "@/components/RunProgress";
import StatusBadge from "@/components/StatusBadge";
import { formatDuration, formatWhen } from "@/lib/format";
import type { ExecutionDetail, ExecutionSummary, N8nStatus } from "@/lib/n8n";

const SELECTED_KEY = "ca:selected";
const RUNS_PAGE = 5;
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

  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [pinning, setPinning] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // Two slots, because they have different lifetimes. An error from something
  // the person just did has to stay on screen until they do something else;
  // one from a background poll is about right now and goes as soon as the next
  // poll succeeds. Sharing one slot meant the pollers cleared it: a run that
  // failed to start showed why for as long as it took the history poll to come
  // back, a few seconds, and then the reason was simply gone.
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Which steps are pinned right now, as opposed to which steps some past run
  // happened to return a pinned value for.
  const [pinnedSteps, setPinnedSteps] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // The list is long and mostly noise, so it starts collapsed and grows a page
  // at a time. Reset in loadHistory would fight the poller, so it only grows.
  const [visibleRuns, setVisibleRuns] = useState(RUNS_PAGE);

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
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not reach n8n.");
    }
  }, []);

  // Which run the newest request was for. A poll every few seconds against a
  // list the person is clicking through means responses do come back out of
  // order, and the loser used to win: select a run, select another before the
  // first answers, and the first answer overwrites the second run's detail with
  // the wrong run's steps — under the right run's heading.
  const wantedDetail = useRef<string | null>(null);

  const loadPins = useCallback(async () => {
    try {
      const response = await fetch("/api/pins", { cache: "no-store" });
      if (!response.ok) return;
      const payload = (await response.json()) as { pins?: { step: string }[] };
      setPinnedSteps(new Set((payload.pins ?? []).map((p) => p.step)));
    } catch {
      /* the buttons fall back to the run's own flag */
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    wantedDetail.current = id;
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/runs/${id}`, { cache: "no-store" });
      if (wantedDetail.current !== id) return;
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();

      // A remembered run the current backend has never heard of. Forget it,
      // rather than polling an id that will never resolve — this happens to
      // everyone once, the first time RUN_BACKEND changes.
      if (response.status === 404) {
        setSelectedId(null);
        setDetail(null);
        try {
          window.localStorage.removeItem(SELECTED_KEY);
        } catch {
          /* private mode, cleared storage */
        }
        setError(payload.error ?? "That run no longer exists.");
        return;
      }

      if (!response.ok) throw new Error(payload.error ?? "Could not load run.");
      setDetail(payload.execution);
      setLoadError(null);
    } catch (e) {
      if (wantedDetail.current !== id) return;
      setLoadError(e instanceof Error ? e.message : "Could not reach the backend.");
    } finally {
      // Only the newest request may turn the spinner off, or a slow answer for
      // a run nobody is looking at any more clears the spinner for one that is
      // still loading.
      if (wantedDetail.current === id) setDetailLoading(false);
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
    void loadPins();

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
  }, [loadHistory, loadPins, loadDetail]);

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
        // The engine runs a few at a time, so a run started while others are
        // going may be waiting rather than working. Shown because those two
        // look identical in the panel, and "why is it stuck" is the question
        // that follows.
        if (payload.note) setNotice(String(payload.note));
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

  async function startBatch(values: RunValues, urls: string[]) {
    setStarting(true);
    setError(null);
    setNotice(null);
    setFieldErrors({});

    try {
      const response = await fetch("/api/runs/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...values, urls }),
      });

      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not start the batch.");

      const started = payload.started ?? [];
      const failed = payload.failed ?? [];
      const skipped = payload.skipped ?? [];

      // Open the first one, so there is something to watch immediately.
      const first = started.find((r: { executionId: string | null }) => r.executionId);
      if (first?.executionId) selectRun(String(first.executionId));

      const parts = [
        `Queued ${started.length} run${started.length === 1 ? "" : "s"}.`,
      ];
      if (failed.length > 0) {
        parts.push(
          `${failed.length} could not start: ` +
            failed
              .slice(0, 3)
              .map((f: { url: string; error: string }) => `${f.url} (${f.error})`)
              .join("; ") +
            (failed.length > 3 ? "…" : "")
        );
      }
      if (skipped.length > 0) {
        parts.push(
          `${skipped.length} were not sent before the request ran out of time — start them again.`
        );
      }
      setNotice(parts.join(" "));

      void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the batch.");
    } finally {
      setStarting(false);
    }
  }

  /**
   * Freezes a step, or lets it run again.
   *
   * Pinning is keyed on the step's name and applies to every run afterwards,
   * not just this one — so the notice says what was frozen rather than a bare
   * "done". A pin left on a drafting step writes the same article for every
   * page, and the only defence against that is knowing it is there.
   */
  async function pinStep(step: string, pin: boolean) {
    if (!selectedId) return;
    setPinning(step);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/pins", {
        method: pin ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(pin ? { run: selectedId, step } : { step }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error ?? "That did not work.");
      setNotice(
        pin
          ? `Pinned "${step}". Every run from now on returns this saved value instead of running that step, until you unpin it.`
          : `Unpinned "${step}". It runs again from the next run.`,
      );
      await Promise.all([loadPins(), loadDetail(selectedId)]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setPinning(null);
    }
  }

  async function retryRun() {
    if (!selectedId) return;

    setRetrying(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/runs/${selectedId}/retry`, {
        method: "POST",
      });

      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not resume the run.");

      // n8n makes a new execution for the retry, so follow that one.
      if (payload.id && String(payload.id) !== selectedId) {
        setNotice(
          `Retrying #${selectedId} as #${payload.id}, reusing its crawl and any article it finished writing.`
        );
        selectRun(String(payload.id));
      } else {
        setNotice(`Resumed #${selectedId} from the node that failed.`);
        void loadDetail(selectedId);
      }

      void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resume the run.");
    } finally {
      setRetrying(false);
    }
  }

  async function cancelRun() {
    if (!selectedId) return;

    setCancelling(true);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/runs/${selectedId}/stop`, {
        method: "POST",
      });

      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }

      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not stop the run.");

      setNotice(`Run #${selectedId} was cancelled.`);
      await loadDetail(selectedId);
      void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not stop the run.");
    } finally {
      setCancelling(false);
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
            {loadError && loadError !== error ? (
              <div className="alert alert-bad" role="alert">
                {loadError}
              </div>
            ) : null}
            {notice ? <div className="alert alert-warn">{notice}</div> : null}

            <RunForm
              busy={starting}
              fieldErrors={fieldErrors}
              onSubmit={startRun}
          onSubmitBatch={startBatch}
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
              <>
                <ul className="runs">
                  {history.slice(0, visibleRuns).map((run) => (
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
                {history.length > visibleRuns ? (
                  <button
                    type="button"
                    className="btn btn-ghost show-more"
                    onClick={() => setVisibleRuns((n) => n + RUNS_PAGE)}
                  >
                    Show more ({history.length - visibleRuns} older)
                  </button>
                ) : null}
              </>
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
          loading={detailLoading}
          onCancel={cancelRun}
          cancelling={cancelling}
          onRetry={retryRun}
          retrying={retrying}
          onPin={pinStep}
          pinning={pinning}
          pinnedSteps={pinnedSteps}
        />
      </div>
    </div>
  );
}
