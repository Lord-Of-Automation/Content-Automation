"use client";

import StatusBadge from "@/components/StatusBadge";
import { formatDuration, formatWhen } from "@/lib/format";
import type { ExecutionDetail } from "@/lib/n8n";

/** Money at a precision that does not round a fraction of a cent to zero. */
function money(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return "$" + value.toFixed(4);
  return "$" + value.toFixed(2);
}

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

      {execution.cost ? (
        <div className="cost">
          <div className="cost-head">
            <span>What this run cost</span>
            <span className="cost-total">
              {money(execution.cost.total)}
              {execution.cost.incomplete ? "+" : ""}
            </span>
          </div>
          <ul className="cost-lines">
            {execution.cost.lines.map((line) => (
              <li key={line.label}>
                <span className="cost-label">
                  {line.label}
                  {line.exact ? (
                    <span className="stage-tag">exact</span>
                  ) : (
                    <span className="stage-tag">estimated</span>
                  )}
                </span>
                <span className="cost-detail">{line.detail}</span>
                <span className="cost-amount">
                  {line.amount === null ? "—" : money(line.amount)}
                </span>
              </li>
            ))}
          </ul>
          <div className="stage-hint" style={{ marginTop: 8 }}>
            DataForSEO prices each call in its own response, so that part is
            exact. Model usage is priced from token counts at the configured
            rates, so treat it as close rather than billed.
          </div>
        </div>
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
