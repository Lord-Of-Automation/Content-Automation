/**
 * The console, talking to our own engine instead of n8n.
 *
 * This exposes exactly the surface `lib/n8n.ts` does, so the API routes and the
 * components do not care which one is answering. The switch lives in
 * `lib/backend.ts`.
 *
 * Two things get better here rather than merely equal. Progress is *reported*
 * by the stage that is running, instead of being inferred from which n8n node
 * names have appeared — a mapping that silently stopped lighting up whenever a
 * node was renamed. And `dataUnavailable` disappears: that failure mode was
 * n8n withholding a payload too large to store, which this engine does not
 * create because it never stores one.
 */

import type { CostBreakdown } from "./cost";
import type { RunInputs } from "./inputs";
import type { Progress, ProgressStage, StageState } from "./progress";
import type {
  ExecutionDetail,
  ExecutionSummary,
  N8nStatus,
  StartRunInput,
  StartRunResult,
} from "./n8n";
import { credentialsFor } from "./sites";

class EngineConfigError extends Error {}

/**
 * A run this backend has never heard of.
 *
 * Distinct from a general failure because it is usually not a failure at all:
 * switching RUN_BACKEND orphans every id the other side issued, and the
 * console remembers the last one it was looking at.
 */
class RunNotFoundError extends Error {}

function base(): string {
  const url = process.env.ENGINE_URL?.trim();
  if (!url) {
    throw new EngineConfigError(
      "ENGINE_URL is not set. Add it to the project's environment variables.",
    );
  }
  return url.replace(/\/+$/, "");
}

function token(): string {
  const value = process.env.ENGINE_TOKEN?.trim();
  if (!value) {
    throw new EngineConfigError(
      "ENGINE_TOKEN is not set. It must match the value in the engine's .env.",
    );
  }
  return value;
}

async function call<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 30_000,
): Promise<T> {
  const response = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token()}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });

  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text.slice(0, 300) };
  }

  if (response.status === 404) {
    throw new RunNotFoundError(
      "That run does not exist on this backend. Ids from n8n and from the " +
        "engine are separate, so switching backends leaves the old ones behind.",
    );
  }

  if (!response.ok) {
    // The `missing` list is the actionable half. It was being dropped whenever
    // `error` was present, which is exactly when it is set.
    const detail = Array.isArray(body?.missing) && body.missing.length
      ? ` Missing: ${body.missing.join(", ")}.`
      : "";
    const message =
      (body?.error ?? `The engine answered ${response.status} for ${path}.`) + detail;
    throw new Error(message);
  }
  return body as T;
}

/** What the engine reports for one run. */
type EngineStep = {
  name: string;
  status: "ok" | "failed" | "skipped";
  startedAt: string;
  ms: number;
  note?: string;
  error?: string;
  /** A bounded snapshot of what the step produced. Absent on most steps. */
  output?: unknown;
};

type EngineRun = {
  id: string;
  status: "queued" | "running" | "success" | "error" | "canceled";
  finished: boolean;
  startedAt: string;
  stoppedAt: string | null;
  website_url: string;
  error: string | null;
  progress: { done: number; total: number; percent: number };
  current?: { url: string; index: number; total: number; startedAt: string } | null;
  result: {
    pages_optimised: number;
    published: Array<{ url?: string; postId?: number | string | null }>;
    skipped: unknown[];
  };
  input?: Record<string, unknown>;
  /** Counted by the engine as it spent it. Absent on a run older than that. */
  cost?: CostBreakdown | null;
  /** Which pipeline ran it. Absent on a run from before there was a choice. */
  mode?: "optimise" | "gap";
  steps?: EngineStep[];
};

/** The console's vocabulary is n8n's; the engine's maps onto it cleanly. */
function statusOf(run: EngineRun): N8nStatus {
  switch (run.status) {
    case "queued":
      return "new";
    case "running":
      return "running";
    case "success":
      return "success";
    case "error":
      return "error";
    case "canceled":
      return "canceled";
    default:
      return "unknown";
  }
}

function summarise(run: EngineRun): ExecutionSummary {
  return {
    id: run.id,
    status: statusOf(run),
    finished: run.finished,
    mode: "api",
    startedAt: run.startedAt,
    stoppedAt: run.stoppedAt,
    workflowId: "engine",
  };
}

/**
 * Progress built from the steps the engine actually ran.
 *
 * Each step is its own stage, in the order it happened, so the panel shows
 * what the run did rather than what a hardcoded list expected it to do.
 */
function progressOf(run: EngineRun): Progress {
  const steps = run.steps ?? [];

  const stages: ProgressStage[] = steps.map((step) => {
    // A failed step used to map to "active", so it read as still running and
    // never stopped. It has its own state now.
    const state: StageState =
      step.status === "skipped" ? "skipped" : step.status === "ok" ? "done" : "failed";
    return {
      key: step.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      label: step.name,
      hint: step.error ?? step.note ?? `${(step.ms / 1000).toFixed(1)}s`,
      nodes: [],
      state,
      nodesRun: 1,
      output: step.output,
    };
  });

  // A run still going has one more stage in flight than it has recorded.
  if (!run.finished) {
    stages.push({
      key: "in-flight",
      label: "Working",
      hint: "the next stage is running",
      nodes: [],
      state: "active",
      nodesRun: 0,
    });
  }

  const done = steps.filter((s) => s.status === "ok").length;

  return {
    stages,
    currentLabel: run.finished ? null : (steps.at(-1)?.name ?? "Starting"),
    percent: run.finished ? 100 : run.progress?.percent ?? 0,
    nodesExecuted: done,
    // Absent on a run that finished, and on any record written before the
    // engine began reporting it.
    currentPage: run.current
      ? { url: run.current.url, index: run.current.index, total: run.current.total }
      : null,
    // Written as each page is published, so this grows while the run is going
    // and is the finished list once it stops. A record from before the engine
    // reported any of this simply has none.
    donePages: (run.result?.published ?? [])
      .filter((p) => p && typeof p.url === "string" && p.url)
      .map((p) => ({ url: p.url as string, postId: p.postId ?? null })),
  };
}

function inputsOf(run: EngineRun): RunInputs | null {
  const i = run.input;
  if (!i) return null;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  return {
    website_url: (i.website_url as string) ?? null,
    market: (i.market as string) ?? null,
    language: (i.language as string) ?? null,
    max_crawl_pages: num(i.max_crawl_pages),
    pages_to_optimise: num(i.pages_to_optimise),
    reuse_crawl_days: num(i.reuse_crawl_days),
    exclude_paths: Array.isArray(i.exclude_paths) ? (i.exclude_paths as string[]) : [],
    brief_doc_id: (i.brief_doc_id as string) ?? null,
    body_classes:
      i.body_classes && typeof i.body_classes === "object"
        ? (i.body_classes as RunInputs["body_classes"])
        : {},
  };
}

export async function startRun(
  input: StartRunInput,
  resumeFrom?: string,
): Promise<StartRunResult> {
  const startedAt = new Date().toISOString();

  // WordPress credentials travel with the run, so the console stays the one
  // place sites are managed and the engine keeps no credential store.
  const credentials = await credentialsFor(input.website_url);

  const body = {
    ...input,
    ...(resumeFrom ? { resume_from: resumeFrom } : {}),
    ...(credentials
      ? {
          wp_username: credentials.username,
          wp_password: credentials.password,
          wp_domain: credentials.domain,
        }
      : {}),
  };

  const result = await call<{ id: string; note?: string }>(
    "/runs",
    { method: "POST", body: JSON.stringify(body) },
    30_000,
  );

  return {
    executionId: result.id,
    startedAt,
    assumed: false,
    note: result.note ?? null,
  };
}

export async function listExecutions(limit = 20): Promise<ExecutionSummary[]> {
  const { runs } = await call<{ runs: EngineRun[] }>(`/runs?limit=${limit}`);
  return runs.map(summarise);
}

export async function getExecution(id: string): Promise<ExecutionDetail> {
  const run = await call<EngineRun>(`/runs/${encodeURIComponent(id)}`);

  return {
    ...summarise(run),
    progress: progressOf(run),
    lastNodeExecuted: run.steps?.at(-1)?.name ?? null,
    error: run.error,
    // The engine never withholds a payload, because it never stores one.
    dataUnavailable: null,
    // Counted by the engine while the run ran, not derived here. There is no
    // payload to derive it from — which is the point of the engine — so a run
    // from before it kept a ledger has no cost and never will.
    cost: run.cost ?? null,
    inputs: inputsOf(run),
  };
}

export async function stopExecution(id: string): Promise<N8nStatus> {
  await call(`/runs/${encodeURIComponent(id)}/stop`, { method: "POST" });
  return "canceled";
}

/**
 * n8n needed this because a triggered run did not return its own id, so the
 * console looked for one that began just after. The engine returns its id, so
 * there is nothing to look up.
 */
export async function findExecutionStartedAfter(): Promise<ExecutionSummary | null> {
  return null;
}

/**
 * Retries a run, reusing what the failed one already paid for.
 *
 * The engine keeps each run's crawl task and any finished article, so a retry
 * resumes rather than re-buying: a publish failure costs the publish call
 * again, not the crawl, the research and the draft.
 *
 * n8n could not do this — it replayed the workflow snapshot stored with the
 * original execution, which is why a retry there so often reproduced the
 * original failure exactly.
 */
export async function retryExecution(id: string): Promise<{ id: string; status: N8nStatus }> {
  const run = await call<EngineRun>(`/runs/${encodeURIComponent(id)}`);
  const inputs = inputsOf(run);
  if (!inputs?.website_url) {
    throw new Error(`Run ${id} has no recorded input to retry from.`);
  }
  const started = await startRun({
    website_url: inputs.website_url,
    market: inputs.market ?? "gb",
    language: inputs.language ?? "en",
    max_crawl_pages: inputs.max_crawl_pages ?? 200,
    pages_to_optimise: inputs.pages_to_optimise ?? 0,
    reuse_crawl_days: inputs.reuse_crawl_days ?? 0,
    exclude_paths: inputs.exclude_paths,
    brief_doc_id: inputs.brief_doc_id ?? "",
    // A retry is the same run again, so the declarations go with it.
    body_classes: inputs.body_classes,
    // And so does which pipeline it was. Retrying a failed gap run as the
    // optimiser would rewrite the site's existing pages instead of writing the
    // missing ones — the wrong work entirely, done quietly and successfully.
    mode: run.mode ?? "optimise",
    ideas_sheet_id: (run.input?.ideas_sheet_id as string) ?? "",
  }, id);
  return { id: started.executionId ?? "", status: "new" };
}

export function workflowId(): string {
  return "engine";
}

export function isTerminal(status: N8nStatus): boolean {
  return status === "success" || status === "error" || status === "canceled" || status === "crashed";
}

export { EngineConfigError, RunNotFoundError };
