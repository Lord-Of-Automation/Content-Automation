"use client";

import { useState } from "react";

import ConfirmDialog from "@/components/ConfirmDialog";
import StatusBadge from "@/components/StatusBadge";
import { formatDuration, formatWhen } from "@/lib/format";
import { LANGUAGES, MARKETS } from "@/lib/markets";
import type { ExecutionDetail, N8nStatus } from "@/lib/n8n";
import type { RunInputs } from "@/lib/inputs";

/**
 * Repeated from Console rather than imported from lib/n8n, which would drag the
 * whole server-side client into the browser bundle for one predicate.
 */
function isTerminal(status: N8nStatus | undefined): boolean {
  return (
    status === "success" ||
    status === "error" ||
    status === "crashed" ||
    status === "canceled"
  );
}

/** Money at a precision that does not round a fraction of a cent to zero. */
function money(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return "$" + value.toFixed(4);
  return "$" + value.toFixed(2);
}

/** The submitted values, spelled out the way the form asked for them. */
function inputRows(inputs: RunInputs): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];

  if (inputs.website_url) {
    rows.push({ label: "Website", value: inputs.website_url });
  }

  if (inputs.market) {
    const match = MARKETS.find((m) => m.code === inputs.market);
    rows.push({
      label: "Market",
      value: match ? `${match.label} (${match.code})` : inputs.market,
    });
  }

  if (inputs.language) {
    const match = LANGUAGES.find((l) => l.code === inputs.language);
    rows.push({
      label: "Language",
      value: match ? `${match.label} (${match.code})` : inputs.language,
    });
  }

  if (inputs.max_crawl_pages !== null) {
    rows.push({
      label: "Crawl limit",
      // Zero is the form's "no limit", so echoing the digit would misreport it.
      value:
        inputs.max_crawl_pages === 0
          ? "Every page"
          : `${inputs.max_crawl_pages} page${inputs.max_crawl_pages === 1 ? "" : "s"}`,
    });
  }

  if (inputs.pages_to_optimise !== null) {
    rows.push({
      label: "Pages to optimise",
      value:
        inputs.pages_to_optimise === 0
          ? "Every crawled page"
          : `${inputs.pages_to_optimise} page${inputs.pages_to_optimise === 1 ? "" : "s"}`,
    });
  }

  if (inputs.reuse_crawl_days !== null) {
    rows.push({
      label: "Reuse a crawl",
      value:
        inputs.reuse_crawl_days === 0
          ? "No — always crawled fresh"
          : `If one exists from the last ${inputs.reuse_crawl_days} day${
              inputs.reuse_crawl_days === 1 ? "" : "s"
            }`,
    });
  }

  if (inputs.exclude_paths.length > 0) {
    rows.push({
      label: "Never optimise",
      value: inputs.exclude_paths.join(", "),
    });
  }

  // Said either way. A missing row reads as "not recorded"; the point here is
  // that writing without the brief is a choice someone made, and a run that
  // reads oddly later should say so on its own record.
  rows.push(
    inputs.brief_doc_id
      ? { label: "Brief document", value: inputs.brief_doc_id }
      : { label: "Brief document", value: "None — written without the house voice" },
  );

  return rows;
}

/**
 * Which page the run is on.
 *
 * Shown for a bulk run and a single-page one alike: on a single page the count
 * reads "1 of 1", which is honest and keeps the box from changing shape
 * between the two. The address is the useful part either way — a run that has
 * been going twenty minutes should not require reading the step list to learn
 * what it is working on.
 */
function CurrentPage({ page }: { page: { url: string; index: number; total: number } }) {
  // The path alone. The host is the same for every page in a run and is
  // already named in the inputs above, so repeating it just pushes the part
  // that differs off the end of the line.
  let path = page.url;
  try {
    const parsed = new URL(page.url);
    path = parsed.pathname + parsed.search;
  } catch {
    /* not a URL: show whatever was recorded */
  }

  return (
    <div className="current-page">
      <span className="current-page-label">
        {page.total > 1 ? `Optimising ${page.index} of ${page.total}` : "Optimising"}
      </span>
      <a
        className="current-page-url mono"
        href={page.url}
        target="_blank"
        rel="noopener noreferrer"
        title={page.url}
      >
        {path}
      </a>
    </div>
  );
}

/**
 * The pages this run has already finished.
 *
 * Closed by default: while a run is going the interesting line is the one above
 * it, and on a forty-page run an open list would push everything else off the
 * screen. The count is on the summary, so it says how many without opening.
 *
 * A disclosure rather than a select, because these are addresses worth opening
 * — a select would list them and give no way to reach them.
 */
function DonePages({ pages }: { pages: { url: string; postId: number | string | null }[] }) {
  const pathOf = (url: string): string => {
    try {
      const parsed = new URL(url);
      return parsed.pathname + parsed.search;
    } catch {
      return url;
    }
  };

  return (
    <details className="done-pages">
      <summary>
        {pages.length} {pages.length === 1 ? "page" : "pages"} done
      </summary>
      <ol className="done-pages-list">
        {pages.map((page) => (
          <li key={`${page.url}-${page.postId ?? ""}`}>
            <a href={page.url} target="_blank" rel="noopener noreferrer" title={page.url}>
              {pathOf(page.url)}
            </a>
          </li>
        ))}
      </ol>
    </details>
  );
}

/**
 * One value out of a step's recorded output.
 *
 * Rendered structurally rather than as a blob of JSON: a list of addresses is
 * far more useful as a list of addresses, and half of what these steps produce
 * is exactly that. Anything unrecognised still falls through to readable text,
 * so an odd shape degrades rather than disappearing.
 */
function OutputValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) {
    return <span className="output-empty">none</span>;
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return <span className="output-scalar">{String(value)}</span>;
  }

  if (typeof value === "string") {
    // The engine records plenty of addresses; making them clickable is the
    // difference between reading a list and checking one.
    if (/^https?:\/\//.test(value)) {
      return (
        <a href={value} target="_blank" rel="noopener noreferrer" className="output-link">
          {value.replace(/^https?:\/\/[^/]+/, "") || value}
        </a>
      );
    }
    return <span>{value}</span>;
  }

  if (Array.isArray(value)) {
    if (!value.length) return <span className="output-empty">none</span>;
    return (
      <ol className="output-list">
        {value.map((item, i) => (
          <li key={i}>
            <OutputValue value={item} depth={depth + 1} />
          </li>
        ))}
      </ol>
    );
  }

  if (typeof value === "object") {
    const rows = Object.entries(value as Record<string, unknown>);
    if (!rows.length) return <span className="output-empty">none</span>;
    return (
      <dl className="output-rows">
        {rows.map(([key, val]) => (
          <div key={key}>
            <dt>{key.replace(/_/g, " ")}</dt>
            <dd>
              <OutputValue value={val} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return <span>{String(value)}</span>;
}

/** Closed by default: twenty-odd open steps would bury the run. */
function StageOutput({ output }: { output: unknown }) {
  return (
    <details className="stage-output">
      <summary>Output</summary>
      <div className="stage-output-body">
        <OutputValue value={output} />
      </div>
    </details>
  );
}

export default function RunProgress({
  execution,
  loading,
  onCancel,
  cancelling,
  onRetry,
  retrying,
  onPin,
  pinning,
}: {
  execution: ExecutionDetail | null;
  loading: boolean;
  onCancel?: () => void;
  cancelling?: boolean;
  onRetry?: () => void;
  retrying?: boolean;
  /** Pin or unpin a step by name. Absent on a backend that cannot pin. */
  onPin?: (step: string, pin: boolean) => void;
  /** The step a pin request is in flight for, so its button can say so. */
  pinning?: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
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

      {progress?.currentPage ? <CurrentPage page={progress.currentPage} /> : null}
      {progress?.donePages?.length ? <DonePages pages={progress.donePages} /> : null}

      {execution.inputs ? (
        <div className="inputs">
          <div className="inputs-head">What was asked for</div>
          <dl className="inputs-list">
            {inputRows(execution.inputs).map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd
                  // Monospace suits a file ID; it does not suit a sentence.
                  className={
                    row.label === "Brief document" && !row.value.startsWith("None")
                      ? "mono"
                      : undefined
                  }
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {execution.error ? (
        <div className="alert alert-bad" style={{ marginTop: 16 }}>
          <strong>Run failed.</strong> {execution.error}
          {onRetry ? (
            <>
              {" "}
              Resume from failure carries on from that node, keeping the crawl
              and research already paid for.
            </>
          ) : null}
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

      {!progress && !isTerminal(execution.status) ? (
        <div className="alert alert-warn" style={{ marginTop: 16 }}>
          n8n has not written any node data for this run yet, so there are no
          stages to show. It publishes progress as the run goes only when
          &ldquo;Save execution progress&rdquo; is on for the workflow; the
          stages fill in from the first node once it does.
        </div>
      ) : null}

      {progress ? (
        <ul className="stages">
          {progress.stages.map((stage) => (
            <li key={stage.key} className={`stage stage-${stage.state}`}>
              <span className="stage-mark" aria-hidden="true">
                {stage.state === "failed" ? "✕" : "✓"}
              </span>
              <span style={{ minWidth: 0 }}>
                <span className="stage-name">
                  {stage.label}
                  {stage.state === "skipped" ? (
                    <span className="stage-tag">not needed</span>
                  ) : null}
                  {stage.state === "failed" ? (
                    <span className="stage-tag">failed</span>
                  ) : null}
                  {stage.state === "done" && stage.nodesRun > 0 && !stage.pinned ? (
                    <span className="stage-tag">{stage.nodesRun} steps</span>
                  ) : null}
                  {/* Only where there is something to pin. A skipped step
                      returned no value, and the placeholder "Working" row is a
                      label rather than a step, so neither can be keyed on. */}
                  {onPin && stage.stepName && stage.state !== "skipped" && stage.state !== "active" ? (
                    <button
                      type="button"
                      /* The button is the state as well as the control. A
                         separate "pinned" tag beside a button reading the same
                         word was the label twice and the meaning once. */
                      className={stage.pinned ? "stage-pin is-pinned" : "stage-pin"}
                      disabled={pinning === stage.stepName}
                      title={
                        stage.pinned
                          ? "Pinned: this step returns a saved value instead of running. Click to unpin."
                          : "Pin this result: the step stops running and returns it instead"
                      }
                      onClick={() => onPin(stage.stepName!, !stage.pinned)}
                    >
                      {pinning === stage.stepName ? "…" : stage.pinned ? "pinned" : "Pin"}
                    </button>
                  ) : null}
                </span>
                <span className="stage-hint">{stage.hint}</span>
                {stage.output !== undefined && stage.output !== null ? (
                  <StageOutput output={stage.output} />
                ) : null}
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
      <div className="run-actions">
        {onRetry &&
        (execution.status === "error" || execution.status === "crashed") ? (
          <button
            type="button"
            className="btn btn-primary-soft"
            onClick={onRetry}
            disabled={retrying}
            title="Carry on from the node that failed, keeping the work already done"
          >
            {retrying ? "Resuming…" : "Resume from failure"}
          </button>
        ) : null}

        {onCancel && !isTerminal(execution.status) ? (
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => setConfirming(true)}
            disabled={cancelling}
          >
            {cancelling ? "Stopping…" : "Cancel run"}
          </button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirming}
        busy={cancelling}
        title={`Stop run #${execution.id}?`}
        confirmLabel="Stop the run"
        busyLabel="Stopping…"
        onDismiss={() => setConfirming(false)}
        onConfirm={() => {
          onCancel?.();
          setConfirming(false);
        }}
        body={
          <>
            <p>
              The steps that have not run yet will be skipped and the run will
              be marked cancelled.
            </p>
            <p className="confirm-warn">
              Work already paid for is not refunded. If the crawl has been
              billed, stopping saves what is left, not what is spent.
            </p>
          </>
        }
      />
    </div>
  );
}
