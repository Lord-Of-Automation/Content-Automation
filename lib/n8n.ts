import { buildProgress, type Progress } from "./progress";
import { estimateCost, type CostBreakdown } from "./cost";
import { extractInputs, type RunInputs } from "./inputs";
import { credentialsFor } from "./sites";

export type N8nStatus =
  | "new"
  | "running"
  | "waiting"
  | "success"
  | "error"
  | "crashed"
  | "canceled"
  | "unknown";

export type ExecutionSummary = {
  id: string;
  status: N8nStatus;
  finished: boolean;
  mode: string | null;
  startedAt: string | null;
  stoppedAt: string | null;
  workflowId: string | null;
};

export type ExecutionDetail = ExecutionSummary & {
  progress: Progress | null;
  lastNodeExecuted: string | null;
  error: string | null;
  /** Set when the run data was too large or withheld, so progress is unavailable. */
  dataUnavailable: string | null;
  /** What the run spent, where the payload says so. Null without run data. */
  cost: CostBreakdown | null;
  /** What was submitted to start it, read back out of the payload. */
  inputs: RunInputs | null;
};

export type StartRunInput = {
  website_url: string;
  market: string;
  language: string;
  max_crawl_pages: number;
  pages_to_optimise: number;
  /** Reuse a finished crawl of the same domain this many days old. 0 = never. */
  reuse_crawl_days: number;
  brief_doc_id: string;
};

export type StartRunResult = {
  executionId: string | null;
  startedAt: string;
  /** True when we never got a clean response and are assuming it started. */
  assumed: boolean;
  note: string | null;
};

class N8nConfigError extends Error {}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new N8nConfigError(
      `${name} is not set. Add it in Vercel > Settings > Environment Variables.`
    );
  }
  return value.trim();
}

function baseUrl(): string {
  return requireEnv("N8N_BASE_URL").replace(/\/+$/, "");
}

export function workflowId(): string {
  return (process.env.N8N_WORKFLOW_ID || "rK5Va4IFiHgasLWp").trim();
}

function triggerMode(): "webhook" | "form" {
  return process.env.N8N_TRIGGER_MODE === "form" ? "form" : "webhook";
}

function triggerUrl(): string {
  return requireEnv("N8N_TRIGGER_URL").trim();
}

async function apiFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = 30_000, ...rest } = init;

  return fetch(`${baseUrl()}/api/v1${path}`, {
    ...rest,
    headers: {
      "X-N8N-API-KEY": requireEnv("N8N_API_KEY"),
      accept: "application/json",
      ...(rest.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function normaliseStatus(raw: unknown, finished: boolean): N8nStatus {
  const value = typeof raw === "string" ? raw.toLowerCase() : "";
  const known: N8nStatus[] = [
    "new",
    "running",
    "waiting",
    "success",
    "error",
    "crashed",
    "canceled",
    "unknown",
  ];
  if ((known as string[]).includes(value)) return value as N8nStatus;
  return finished ? "success" : "running";
}

export function isTerminal(status: N8nStatus): boolean {
  return (
    status === "success" ||
    status === "error" ||
    status === "crashed" ||
    status === "canceled"
  );
}

function toSummary(raw: Record<string, unknown>): ExecutionSummary {
  const finished = Boolean(raw.finished);
  return {
    id: String(raw.id),
    status: normaliseStatus(raw.status, finished),
    finished,
    mode: typeof raw.mode === "string" ? raw.mode : null,
    startedAt: typeof raw.startedAt === "string" ? raw.startedAt : null,
    stoppedAt: typeof raw.stoppedAt === "string" ? raw.stoppedAt : null,
    workflowId: raw.workflowId != null ? String(raw.workflowId) : null,
  };
}

/**
 * Kick off a run.
 *
 * In webhook mode the patched workflow answers immediately with the execution
 * id, which is the only way to track a run deterministically. In form mode we
 * post to the Form Trigger and fall back to matching on start time, because the
 * form trigger never tells you which execution it created.
 */
export async function startRun(input: StartRunInput): Promise<StartRunResult> {
  const startedAt = new Date().toISOString();
  const mode = triggerMode();

  // A registered site's WordPress login travels with the run, so the workflow
  // can publish to any domain rather than only the one wired into its own
  // credentials. Absent is fine: the workflow falls back to its own.
  const site = await credentialsFor(input.website_url).catch(() => null);
  const payload: Record<string, unknown> = { ...input };
  if (site) {
    payload.wp_username = site.username;
    payload.wp_password = site.password;
    payload.wp_domain = site.domain;
  }

  // The Form Trigger asserts the submission is multipart/form-data and throws
  // "Expected multipart/form-data" on anything else, urlencoded included. Handing
  // fetch a FormData instance makes it write the multipart body and the boundary,
  // so this branch must NOT set content-type itself: doing that omits the boundary
  // and n8n cannot parse the body.
  let body: string | FormData;
  const headers: Record<string, string> = {};

  if (mode === "webhook") {
    body = JSON.stringify(payload);
    headers["content-type"] = "application/json";
  } else {
    const form = new FormData();
    form.set("website_url", input.website_url);
    form.set("market", input.market);
    form.set("language", input.language);
    form.set("max_crawl_pages", String(input.max_crawl_pages));
    form.set("pages_to_optimise", String(input.pages_to_optimise));
    form.set("reuse_crawl_days", String(input.reuse_crawl_days));
    if (site) {
      form.set("wp_username", site.username);
      form.set("wp_password", site.password);
      form.set("wp_domain", site.domain);
    }
    form.set("brief_doc_id", input.brief_doc_id);
    body = form;
  }

  const secret = process.env.N8N_WEBHOOK_SECRET;
  if (secret && mode === "webhook") headers["x-trigger-secret"] = secret;

  let response: Response;
  try {
    response = await fetch(triggerUrl(), {
      method: "POST",
      headers,
      body,
      cache: "no-store",
      // The trigger should answer in milliseconds. If it does not, the workflow
      // is very likely running anyway and just configured to respond at the end,
      // so we stop waiting rather than hold the serverless function open.
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");

    if (timedOut) {
      return {
        executionId: null,
        startedAt,
        assumed: true,
        note: "n8n did not respond within 20s. The run has almost certainly started; matching it by start time.",
      };
    }
    throw error;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");

    // n8n serves a trigger URL only while the workflow is activated, and it
    // auto-deactivates a workflow after repeated crashed executions. A 404 here
    // is far more often that than a wrong URL, so name the likely cause.
    if (response.status === 404) {
      throw new Error(
        "n8n returned 404 for the trigger URL, which almost always means the " +
          "workflow is not active. Open it in n8n, switch it back on, and try again."
      );
    }
    throw new Error(
      `n8n trigger returned ${response.status}. ${text.slice(0, 300)}`
    );
  }

  // Look for an execution id however the workflow chose to phrase it.
  let executionId: string | null = null;
  try {
    const payload = (await response.json()) as Record<string, unknown>;
    const candidate =
      payload.executionId ?? payload.execution_id ?? payload.id ?? null;
    if (candidate != null && String(candidate).length > 0) {
      executionId = String(candidate);
    }
  } catch {
    // Form trigger answers with HTML, and an unpatched webhook answers with
    // {"message":"Workflow was started"}. Neither is a problem.
  }

  return {
    executionId,
    startedAt,
    assumed: executionId === null,
    note:
      executionId === null
        ? "n8n did not return an execution id, so this run is matched by start time. Apply the workflow patch for exact tracking."
        : null,
  };
}

export async function listExecutions(limit = 20): Promise<ExecutionSummary[]> {
  const capped = Math.min(Math.max(limit, 1), 250);

  // The unfiltered list returns only FINISHED executions, so a run that is still
  // in flight is missing from it until it stops. Ask for the live states as well
  // and merge. (Older n8n rejected "running" as a filter value, issue #19664; 2.x
  // accepts it, and an instance that still refuses just contributes nothing.)
  //
  // A 70s Wait node parks the execution in "waiting", not "running", so both
  // matter here, and "new" covers a run that is queued but not yet started.
  const queries: Array<string | null> = ["running", "waiting", "new", null];

  const results = await Promise.all(
    queries.map(async (status) => {
      const params = new URLSearchParams({
        workflowId: workflowId(),
        limit: String(capped),
        includeData: "false",
      });
      if (status) params.set("status", status);

      let response: Response;
      try {
        response = await apiFetch(`/executions?${params.toString()}`);
      } catch (error) {
        // Only the unfiltered list is required; the live queries are a bonus.
        if (status) return [];
        throw error;
      }

      if (!response.ok) {
        if (status) return [];
        const text = await response.text().catch(() => "");
        throw new Error(
          `n8n executions API returned ${response.status}. ${text.slice(0, 300)}`
        );
      }

      const payload = (await response.json()) as { data?: unknown };
      return Array.isArray(payload.data) ? payload.data : [];
    })
  );

  // Live queries are merged first so the unfiltered list, which is the one that
  // carries a stoppedAt, wins on conflict. Without that a run finishing between
  // the two requests would be shown as still running.
  const byId = new Map<string, ExecutionSummary>();
  for (const rows of results) {
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const summary = toSummary(row as Record<string, unknown>);
      byId.set(summary.id, summary);
    }
  }

  const order = (id: string) => {
    const n = Number(id);
    return Number.isFinite(n) ? n : 0;
  };

  return [...byId.values()]
    .sort((a, b) => order(b.id) - order(a.id))
    .slice(0, capped);
}

/**
 * Detail for one execution, including derived progress.
 *
 * includeData pulls the whole run payload, which for this workflow can be
 * several megabytes because base64 screenshots travel with it. That stays on
 * the server: we read the node names out and throw the rest away.
 */
export async function getExecution(id: string): Promise<ExecutionDetail> {
  // Kept under Vercel's 60s function ceiling with room for the fallback fetch
  // below, since this payload is the slow one.
  const withData = await apiFetch(
    `/executions/${encodeURIComponent(id)}?includeData=true`,
    { timeoutMs: 30_000 }
  ).catch(() => null);

  let raw: Record<string, unknown> | null = null;
  let dataUnavailable: string | null = null;

  if (withData && withData.ok) {
    try {
      raw = (await withData.json()) as Record<string, unknown>;
    } catch {
      dataUnavailable =
        "The execution payload was too large for n8n to serialise, so stage progress is not available for this run.";
    }
  } else if (withData) {
    dataUnavailable = `n8n returned ${withData.status} for the detailed payload.`;
  } else {
    dataUnavailable = "Timed out reading the detailed payload from n8n.";
  }

  // Fall back to the light record so status is still correct even when the
  // fat payload could not be read.
  if (!raw) {
    const light = await apiFetch(`/executions/${encodeURIComponent(id)}`);
    if (!light.ok) {
      const text = await light.text().catch(() => "");
      throw new Error(
        `n8n execution ${id} returned ${light.status}. ${text.slice(0, 300)}`
      );
    }
    raw = (await light.json()) as Record<string, unknown>;
  }

  const summary = toSummary(raw);

  // Depending on the n8n version `data` arrives either as an object or as a
  // JSON string straight out of the executions table. Accept both.
  let executionData: Record<string, unknown> | undefined;
  if (typeof raw.data === "string") {
    try {
      executionData = JSON.parse(raw.data) as Record<string, unknown>;
    } catch {
      executionData = undefined;
    }
  } else if (raw.data && typeof raw.data === "object") {
    executionData = raw.data as Record<string, unknown>;
  }

  const resultData = executionData?.resultData as
    | Record<string, unknown>
    | undefined;

  const runData = (resultData?.runData ?? undefined) as
    | Record<string, unknown>
    | undefined;

  const executedNodes = runData ? Object.keys(runData) : [];

  const lastNodeExecuted =
    typeof resultData?.lastNodeExecuted === "string"
      ? resultData.lastNodeExecuted
      : null;

  let error: string | null = null;
  const rawError = resultData?.error as Record<string, unknown> | undefined;
  if (rawError) {
    const message =
      typeof rawError.message === "string" ? rawError.message : "Unknown error";
    const node =
      typeof rawError.node === "object" && rawError.node
        ? (rawError.node as Record<string, unknown>).name
        : undefined;
    error = node ? `${String(node)}: ${message}` : message;
  }

  const running = !isTerminal(summary.status);

  return {
    ...summary,
    lastNodeExecuted,
    error,
    dataUnavailable: executedNodes.length === 0 ? dataUnavailable : null,
    progress:
      executedNodes.length > 0
        ? buildProgress(executedNodes, running, lastNodeExecuted)
        : null,
    // Costs come out of the same payload progress is derived from, so this is
    // free: no extra request, and nothing to reconcile against a second source.
    cost: runData ? estimateCost(runData) : null,
    inputs: extractInputs(runData),
  };
}

/**
 * Re-run a failed execution, resuming rather than starting over.
 *
 * n8n replays the saved run data and picks up at the node that failed, which
 * only works because the workflow saves execution progress: without it there is
 * nothing to resume from and n8n starts at the beginning. A run that died at
 * the drafting stage therefore keeps its crawl, its keyword research and its
 * competitor analysis, all of which have already been paid for.
 */
export async function retryExecution(
  id: string,
  loadWorkflow = true
): Promise<{ id: string; status: N8nStatus }> {
  const response = await apiFetch(
    `/executions/${encodeURIComponent(id)}/retry`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Retrying with the current workflow, not the version that failed: the
      // usual reason for retrying is that the cause has just been fixed.
      body: JSON.stringify({ loadWorkflow }),
      timeoutMs: 30_000,
    }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");

    if (response.status === 403) {
      throw new Error(
        "n8n refused the retry. The API key is missing the " +
          '"execution:retry" scope: reissue it in n8n under Settings > API.'
      );
    }
    if (response.status === 404) {
      throw new Error(`n8n has no execution ${id} to retry.`);
    }
    if (response.status === 409) {
      throw new Error(
        `Execution ${id} cannot be retried. Only a finished run that failed can be, ` +
          "and each one can be retried once."
      );
    }
    throw new Error(
      `n8n returned ${response.status} when retrying. ${text.slice(0, 300)}`
    );
  }

  const payload = (await response.json()) as Record<string, unknown>;
  const summary = toSummary(payload);
  return { id: summary.id || id, status: summary.status };
}

/**
 * Ask n8n to stop a run. Returns the status it reports afterwards.
 *
 * A run sitting in a Wait node is the common case here, and n8n cancels those
 * cleanly. Work already paid for, an OnPage crawl for instance, is not refunded
 * by stopping, so this saves the remaining steps and not the spent ones.
 */
export async function stopExecution(id: string): Promise<N8nStatus> {
  const response = await apiFetch(
    `/executions/${encodeURIComponent(id)}/stop`,
    { method: "POST", timeoutMs: 20_000 }
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");

    // Stopping needs the execution:stop scope, which an older API key may not
    // carry, and that reads as a flat 403 with nothing explaining why.
    if (response.status === 403) {
      throw new Error(
        "n8n refused the stop request. The API key is missing the " +
          "\"execution:stop\" scope: reissue it in n8n under Settings > API."
      );
    }
    if (response.status === 404) {
      throw new Error(
        `n8n has no execution ${id} to stop. It may have already finished.`
      );
    }
    // n8n answers a stop for an already-finished execution with a bare 500.
    // The button is hidden once a run is terminal, so reaching this means the
    // run finished between the page rendering and the click.
    if (response.status === 500) {
      throw new Error(
        `n8n could not stop execution ${id}. It has most likely just ` +
          "finished — refresh to see its final status."
      );
    }
    throw new Error(
      `n8n returned ${response.status} when stopping the run. ${text.slice(0, 300)}`
    );
  }

  try {
    const payload = (await response.json()) as Record<string, unknown>;
    return toSummary(payload).status;
  } catch {
    // A 200 with an unreadable body still means it was accepted.
    return "canceled";
  }
}

/**
 * When the trigger could not hand us an execution id, find the run it created
 * by looking for the newest execution that started at or after we posted.
 */
export async function findExecutionStartedAfter(
  isoTimestamp: string
): Promise<ExecutionSummary | null> {
  const threshold = new Date(isoTimestamp).getTime() - 5_000; // clock skew
  const executions = await listExecutions(10);

  const candidates = executions
    .filter((e) => e.startedAt && new Date(e.startedAt).getTime() >= threshold)
    .sort(
      (a, b) =>
        new Date(a.startedAt ?? 0).getTime() -
        new Date(b.startedAt ?? 0).getTime()
    );

  return candidates[0] ?? null;
}

export function executionUrl(id: string): string {
  return `${baseUrl()}/workflow/${workflowId()}/executions/${id}`;
}

export { N8nConfigError };
