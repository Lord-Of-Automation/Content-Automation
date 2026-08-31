/**
 * Which engine runs the work.
 *
 * One environment variable decides, and both sides expose the same functions,
 * so switching is a redeploy rather than a migration:
 *
 *   RUN_BACKEND=n8n      the hosted workflow (default, unchanged)
 *   RUN_BACKEND=engine   our own service
 *
 * Keeping both live matters while the engine is new. If a run misbehaves you
 * flip one variable and the next run goes back through n8n, with no code
 * change and nothing to roll back.
 */

import * as engine from "./engine";
import * as n8n from "./n8n";

export type Backend = "n8n" | "engine";

export function backend(): Backend {
  return process.env.RUN_BACKEND?.trim().toLowerCase() === "engine" ? "engine" : "n8n";
}

const impl = () => (backend() === "engine" ? engine : n8n);

export const startRun: typeof n8n.startRun = (input) => impl().startRun(input);
export const listExecutions: typeof n8n.listExecutions = (limit) => impl().listExecutions(limit);
export const getExecution: typeof n8n.getExecution = (id) => impl().getExecution(id);
export const stopExecution: typeof n8n.stopExecution = (id) => impl().stopExecution(id);
export const workflowId: typeof n8n.workflowId = () => impl().workflowId();
export const isTerminal: typeof n8n.isTerminal = (status) => impl().isTerminal(status);

/**
 * n8n's trigger does not return the id of the run it started, so the console
 * looks for one that began just after. The engine returns its id, so this is
 * only ever called on the n8n path.
 */
export const findExecutionStartedAfter: typeof n8n.findExecutionStartedAfter = (...args) =>
  backend() === "engine"
    ? engine.findExecutionStartedAfter()
    : n8n.findExecutionStartedAfter(...args);

export const retryExecution: typeof n8n.retryExecution = (...args) =>
  backend() === "engine" ? engine.retryExecution(args[0]) : n8n.retryExecution(...args);

export type {
  ExecutionDetail,
  ExecutionSummary,
  N8nStatus,
  StartRunInput,
  StartRunResult,
} from "./n8n";
