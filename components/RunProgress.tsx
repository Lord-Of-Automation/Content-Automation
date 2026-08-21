"use client";

import StatusBadge from "@/components/StatusBadge";
import { formatDuration, formatWhen } from "@/lib/format";
import type { ExecutionDetail } from "@/lib/n8n";

export default function RunProgress({
  execution,
  n8nUrl,
  loading,
}: {
  execution: ExecutionDetail | null;
  n8nUrl: string | null;
  loading: boolean;
}) {
  if (!execution) {
    return (
      <div className="empty">
        {loading ? "Loading run…" : "Pick a run, or start a new one."}
      </div>
    );
  }

  const { progress } = execution;
  const finished = execution.stoppedAt;

  return (
    <div className="card-body">
      <div className="progress-head">
        <div>
          <div className="progress-now">
            {progress?.currentLabel ?? "Waiting for the first node"}
          </div>
          <div className="stage-hint">
            Execution {execution.id} · started {formatWhen(execution.startedAt)} ·{" "}
            {formatDuration(execution.startedAt, finished)}
            {finished ? " total" : " so far"}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StatusBadge status={execution.status} />
          <span className="progress-pct">{progress?.percent ?? 0}%</span>
        </div>
      </div>

      <div className="bar">
        <span style={{ width: `${progress?.percent ?? 0}%` }} />
      </div>

      {execution.error ? (
        <div className="alert alert-bad" style={{ marginTop: 16 }}>
          <strong>Run failed.</strong> {execution.error}
        </div>
      ) : null}

      {execution.dataUnavailable ? (
        <div className="alert alert-warn" style={{ marginTop: 16 }}>
          {execution.dataUnavailable}
        </div>
      ) : null}

      {execution.status === "success" ? (
        <div className="alert alert-ok" style={{ marginTop: 16 }}>
          <strong>Finished.</strong> The page has been updated in WordPress and
          logged to the Published sheet.
        </div>
      ) : null}

      {progress ? (
        <ul className="stages">
          {progress.stages.map((stage) => (
            <li key={stage.key} className={`stage stage-${stage.state}`}>
              <span className="stage-mark" aria-hidden="true">
                ✓
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="stage-name">
                  {stage.label}
                  {stage.state === "skipped" ? (
                    <span className="stage-tag">not needed</span>
                  ) : null}
                  {stage.state === "done" && stage.nodesRun > 0 ? (
                    <span className="stage-tag">{stage.nodesRun} steps</span>
                  ) : null}
                </span>
                <span className="stage-hint">{stage.hint}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {n8nUrl ? (
        <div style={{ marginTop: 18 }}>
          <a
            className="btn btn-ghost"
            href={n8nUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open in n8n ↗
          </a>
        </div>
      ) : null}
    </div>
  );
}
