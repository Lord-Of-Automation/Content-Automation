import { buildProgress, type Progress } from "./progress";

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
};

export type StartRunInput = {
  website_url: string;
  market: string;
  language: string;
  max_crawl_pages: number;
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

  const body =
    mode === "webhook"
      ? JSON.stringify(input)
      : new URLSearchParams({
          website_url: input.website_url,
          market: input.market,
          language: input.language,
          max_crawl_pages: String(input.max_crawl_pages),
          brief_doc_id: input.brief_doc_id,
        }).toString();

  const headers: Record<string, string> =
    mode === "webhook"
      ? { "content-type": "application/json" }
      : { "content-type": "application/x-www-form-urlencoded" };

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
  // Deliberately not filtering by status: the API rejects "running" as a filter
  // value (n8n issue #19664), and we want in-flight runs in this list.
  const params = new URLSearchParams({
    workflowId: workflowId(),
    limit: String(Math.min(Math.max(limit, 1), 250)),
    includeData: "false",
  });

  const response = await apiFetch(`/executions?${params.toString()}`);

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `n8n executions API returned ${response.status}. ${text.slice(0, 300)}`
    );
  }

  const payload = (await response.json()) as { data?: unknown };
  if (!Array.isArray(payload.data)) return [];

  return payload.data
    .filter((row): row is Record<string, unknown> => !!row && typeof row === "object")
    .map(toSummary);
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
  };
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
