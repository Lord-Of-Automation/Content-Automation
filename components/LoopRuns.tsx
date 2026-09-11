"use client";

import { useCallback, useEffect, useState } from "react";

import RunProgress from "@/components/RunProgress";
import StatusBadge from "@/components/StatusBadge";
import { useToasts } from "@/components/Toasts";
import type { ExecutionDetail, ExecutionSummary } from "@/lib/n8n";

/**
 * What the loops on this page have actually been doing.
 *
 * A loop is a promise that something happens at four in the morning, and
 * until now the only evidence it had been kept was a line on the loop box
 * saying when it last fired. Whether that firing worked, what it cost and
 * which pages it touched meant going to the Runs page and working out which
 * of the runs on it were yours — which is a question the Runs page is not
 * arranged to answer, because it holds every run there has ever been.
 *
 * Which runs are a loop's is free to know. The engine already names them for
 * where they came from: a run a loop starts gets an id beginning "loop-",
 * because the same problem showed up in the log first. So this is the run
 * list, filtered on that, and no new endpoint.
 */

const PREFIX = "loop-";
const POLL = 10_000;

function terminal(status: string | undefined): boolean {
  return (
    status === "success" || status === "error" || status === "canceled" || status === "crashed"
  );
}

function when(value: string | null | undefined): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LoopRuns() {
  const { push } = useToasts();

  const [runs, setRuns] = useState<ExecutionSummary[]>([]);
  const [at, setAt] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExecutionDetail | null>(null);

  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = useCallback(async (): Promise<ExecutionSummary[]> => {
    try {
      const response = await fetch("/api/runs", { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return [];
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "The runs could not be read.");
      const rows: ExecutionSummary[] = (payload.executions ?? []).filter((one: ExecutionSummary) =>
        String(one.id ?? "").startsWith(PREFIX),
      );
      setRuns(rows);
      setError(null);
      return rows;
    } catch (e) {
      setError(e instanceof Error ? e.message : "The runs could not be read.");
      return [];
    }
  }, []);

  const loadDetail = useCallback(
    async (id: string) => {
      setReading(true);
      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(id)}`, { cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "That run could not be read.");
        setDetail(payload.execution ?? null);
      } catch (e) {
        push("bad", e instanceof Error ? e.message : "That run could not be read.");
      } finally {
        setReading(false);
      }
    },
    [push],
  );

  // The newest on arrival, which is the one somebody came here to check.
  useEffect(() => {
    void (async () => {
      const rows = await loadList();
      setLoading(false);
      if (rows.length) {
        setAt(rows[0]!.id);
        await loadDetail(rows[0]!.id);
      }
    })();
  }, [loadList, loadDetail]);

  /*
   * Kept current only while something is happening.
   *
   * A loop fires on its own, so this page can be open when one starts and the
   * list should notice. A finished run never changes again, so polling its
   * detail would be asking the same question forever — but the list itself
   * goes on being polled, because the next firing is the thing being waited
   * for.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadList();
      if (at && !terminal(detail?.status)) void loadDetail(at);
    }, POLL);
    return () => window.clearInterval(timer);
  }, [at, detail?.status, loadDetail, loadList]);

  async function stop() {
    if (!at) return;
    setStopping(true);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(at)}/stop`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "It could not be stopped.");
      push("ok", "Stopping. The loop itself keeps its schedule.");
      await loadDetail(at);
      await loadList();
    } catch (e) {
      push("bad", e instanceof Error ? e.message : "It could not be stopped.");
    } finally {
      setStopping(false);
    }
  }

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <h2>Runs from your loops</h2>
          <p>
            Only the runs a loop started, newest first. Anything started by
            hand is on the Runs page instead.
          </p>
        </div>
      </div>

      <div className="card-body">
        {loading ? (
          <p className="provider-hint history-empty">Reading the runs…</p>
        ) : error ? (
          <div className="notice bad mail-notice">{error}</div>
        ) : !runs.length ? (
          <p className="provider-hint history-empty">
            No loop has fired yet. The first one to come due appears here, and
            stays whatever happens to it.
          </p>
        ) : (
          <div className="mail-runs mail-late">
            {/* The list beside the run rather than above it, so reading one
                after another does not move the thing being read. */}
            <nav className="mail-runs-list" aria-label="Loop runs">
              {runs.map((one) => (
                <button
                  key={one.id}
                  type="button"
                  className={one.id === at ? "mail-run is-on" : "mail-run"}
                  onClick={() => {
                    setAt(one.id);
                    void loadDetail(one.id);
                  }}
                >
                  <StatusBadge status={one.status} />
                  {/* The id without the prefix that identified it. Every run
                      in this list came from a loop, so saying so on each row
                      is a word repeated as many times as there are rows.

                      Its own class rather than the campaign list's, which
                      holds an anchor phrase: same weight, mono face, and a
                      shade quieter. */}
                  <span className="loop-run-id mono">{one.id.slice(PREFIX.length)}</span>
                  <span className="mail-run-at">{when(one.startedAt)}</span>
                </button>
              ))}
            </nav>

            <div className="mail-runs-one">
              <RunProgress
                execution={detail}
                loading={reading && !detail}
                onCancel={stop}
                cancelling={stopping}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
