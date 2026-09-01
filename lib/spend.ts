/**
 * What has been spent, per run and per person.
 *
 * Cost is only derivable from the fat execution payload, which is slow to pull,
 * so every finished run is priced once and cached. A finished execution never
 * changes, which makes it safe to cache forever; an unfinished one is skipped
 * rather than cached, because its cost is still moving.
 */

import { readEvents } from "./audit";
import { kvGetJSON, kvSetJSON } from "./kv";
import { getExecution, listExecutions } from "./n8n";

export type RunSpend = {
  id: string;
  actor: string | null;
  at: string | null;
  status: string;
  total: number | null;
  website: string | null;
};

export type Spend = {
  runs: RunSpend[];
  total: number;
  byActor: { actor: string; total: number; runs: number }[];
  byMonth: { month: string; total: number; runs: number }[];
  /** Runs we could not price inside the time budget. */
  unpriced: number;
  cached: boolean;
};

type CachedCost = { total: number | null; website: string | null };

/**
 * The run this log line is about, or null.
 *
 * Details are free text with the id written as `#<id>`, and several actions
 * carry one: started, cancelled, resumed, and the failures of each. The LAST id
 * in the line is the one meant — "Resumed execution #A as #B" is about B, the
 * run that now exists and will cost something.
 *
 * This used to read `\d+`, which was right for n8n, whose ids are numbers, and
 * silently wrong for the engine, whose ids look like 20260901143022-k3f9x. It
 * captured the timestamp, matched no run, and left every engine run in the
 * spend report attributed to nobody.
 */
export function executionIdFrom(detail: string): string | null {
  const found = String(detail ?? "").match(/#[\w-]+/g);
  if (!found?.length) return null;
  return found[found.length - 1]!.slice(1) || null;
}

/**
 * The audit log records who started what as free text, with the execution id
 * appended by the runs route. Pulling the id back out is what links spend to a
 * person, since neither backend has any idea who any of them are.
 */
async function actorsByExecution(): Promise<Map<string, { actor: string; at: string }>> {
  const map = new Map<string, { actor: string; at: string }>();
  const events = await readEvents(500);

  // Oldest first, so the earliest claim on an id wins rather than the latest.
  for (const event of [...events].reverse()) {
    if (event.action !== "run-started") continue;
    const id = executionIdFrom(event.detail);
    if (!id) continue;
    if (!map.has(id)) map.set(id, { actor: event.actor, at: event.at });
  }
  return map;
}

/**
 * What each of these runs cost, for the activity log.
 *
 * Deliberately not collectSpend: that lists runs from the backend and prices
 * every one of them, which is the right shape for a spend report and the wrong
 * one here, where the question is only "what did the runs on this page cost?".
 *
 * A finished run is priced once and cached forever, so the first call after a
 * run ends is the slow one and every later call is a KV read. An unfinished run
 * is never cached — its cost is still moving — so it stays null until it ends,
 * which is also the honest answer to show.
 *
 * Bounded by a deadline because the log polls: a slow answer for some of the
 * rows beats a request that dies at the platform's ceiling and prices none.
 */
export async function priceRuns(
  ids: string[],
  budgetMs = 20_000,
): Promise<Record<string, number>> {
  const deadline = Date.now() + budgetMs;
  const costs: Record<string, number> = {};

  for (const id of [...new Set(ids)]) {
    if (Date.now() > deadline) break;
    const priced = await priceRun(id);
    if (priced?.total !== null && priced?.total !== undefined) costs[id] = priced.total;
  }

  return costs;
}

async function priceRun(id: string): Promise<CachedCost | null> {
  const key = `content-automation:cost:${id}`;

  const cached = await kvGetJSON<CachedCost>(key);
  if (cached) return cached;

  try {
    const execution = await getExecution(id);
    const value: CachedCost = {
      total: execution.cost?.total ?? null,
      website: execution.inputs?.website_url ?? null,
    };
    // Only a finished run has a final cost worth keeping.
    if (execution.stoppedAt) await kvSetJSON(key, value);
    return value;
  } catch {
    return null;
  }
}

function monthOf(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : iso.slice(0, 7);
}

export async function collectSpend(limit = 20): Promise<Spend> {
  const [executions, actors] = await Promise.all([
    listExecutions(limit),
    actorsByExecution(),
  ]);

  // Pricing is the slow part, so it runs against a deadline: a partial answer
  // beats a request that dies at the platform's function ceiling.
  const deadline = Date.now() + 40_000;
  const runs: RunSpend[] = [];
  let unpriced = 0;

  for (const execution of executions) {
    const known = actors.get(execution.id);
    const base: RunSpend = {
      id: execution.id,
      actor: known?.actor ?? null,
      at: execution.startedAt ?? known?.at ?? null,
      status: execution.status,
      total: null,
      website: null,
    };

    if (Date.now() > deadline) {
      unpriced += 1;
      runs.push(base);
      continue;
    }

    const priced = await priceRun(execution.id);
    if (!priced || priced.total === null) unpriced += 1;
    runs.push({ ...base, total: priced?.total ?? null, website: priced?.website ?? null });
  }

  const byActor = new Map<string, { total: number; runs: number }>();
  const byMonth = new Map<string, { total: number; runs: number }>();
  let total = 0;

  for (const run of runs) {
    if (run.total === null) continue;
    total += run.total;

    const actor = run.actor ?? "unattributed";
    const a = byActor.get(actor) ?? { total: 0, runs: 0 };
    byActor.set(actor, { total: a.total + run.total, runs: a.runs + 1 });

    const month = monthOf(run.at);
    if (month) {
      const m = byMonth.get(month) ?? { total: 0, runs: 0 };
      byMonth.set(month, { total: m.total + run.total, runs: m.runs + 1 });
    }
  }

  return {
    runs,
    total,
    byActor: [...byActor.entries()]
      .map(([actor, v]) => ({ actor, ...v }))
      .sort((a, b) => b.total - a.total),
    byMonth: [...byMonth.entries()]
      .map(([month, v]) => ({ month, ...v }))
      .sort((a, b) => b.month.localeCompare(a.month)),
    unpriced,
    cached: true,
  };
}
