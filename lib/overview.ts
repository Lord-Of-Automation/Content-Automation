/**
 * What happened while you were away.
 *
 * The console had no front door. Signing in dropped you on Optimize, which is
 * a form for starting work, not an answer to the question anybody actually
 * arrives with: did last night go well, is anything stuck, what is due next.
 * You had to visit four pages and reconstruct it.
 *
 * This assembles that answer in one pass. Four sources, read together rather
 * than in turn, and each allowed to fail on its own: a registrar being down is
 * not a reason for the overview to be blank, it is one line on the overview
 * saying so.
 *
 * What it deliberately does NOT do is price anything. Pricing walks a fat
 * payload per run and takes tens of seconds on a cold cache, and this is the
 * page that has to appear immediately. Money arrives separately, on its own
 * request, and the card waits for it alone.
 */

import { readEvents } from "./audit";
import { listExecutions } from "./backend";
import { listSchedules, NotOnThisBackend, type Schedule } from "./schedules";
import { executionIdFrom } from "./spend";
import { listWebsites } from "./websites";
import type { N8nStatus } from "./n8n";

export type OverviewRun = {
  id: string;
  status: N8nStatus;
  startedAt: string | null;
  stoppedAt: string | null;
  finished: boolean;
  /** The site it worked on, where anything here knows. Null when nothing does. */
  website: string | null;
  /** Who started it, or the loop that did. */
  by: string | null;
};

export type OverviewLoop = {
  id: string;
  name: string;
  enabled: boolean;
  mode: "optimise" | "gap";
  website: string;
  nextRunAt: string;
  lastRunAt: string | null;
  lastNote: string | null;
};

export type OverviewSite = {
  id: string;
  name: string;
  status: "building" | "ready" | "failed";
  pages: number;
  wanted: number;
  note: string;
  updatedAt: string;
  published: { label: string; address: string; at: string; live: boolean } | null;
};

export type Overview = {
  runs: OverviewRun[];
  loops: OverviewLoop[];
  sites: OverviewSite[];
  /** Why a section is empty, when it is empty because something broke. */
  notes: { runs: string | null; loops: string | null; sites: string | null };
};

/**
 * Which site each run was for.
 *
 * Neither backend records it on a summary, and asking for the detail costs a
 * request per run. The audit log already knows, because the route that starts
 * a run writes the address and the id it got back into the same line.
 *
 * Oldest first so the first claim on an id wins. A resumed run writes a line
 * naming two ids, and the id that matters is the new one, which is what
 * executionIdFrom already returns.
 */
async function sitesByRun(): Promise<Map<string, { website: string; by: string }>> {
  const map = new Map<string, { website: string; by: string }>();

  const events = await readEvents(400);
  for (const event of [...events].reverse()) {
    if (event.action !== "run-started") continue;
    const id = executionIdFrom(event.detail);
    if (!id || map.has(id)) continue;

    // The detail reads "https://site.com (uk/en, 40 pages) → execution #123".
    // Everything before the first bracket is the address.
    const website = event.detail.split(" (")[0]!.trim();
    map.set(id, { website, by: event.actor });
  }
  return map;
}

function loopOf(schedules: Schedule[], runId: string): Schedule | undefined {
  return schedules.find((s) => s.lastRunId === runId);
}

function why(error: unknown): string {
  return error instanceof Error ? error.message : "Could not be read.";
}

export async function collectOverview(): Promise<Overview> {
  const [runs, events, loops, sites] = await Promise.allSettled([
    listExecutions(25),
    sitesByRun(),
    listSchedules(),
    listWebsites(),
  ]);

  const schedules = loops.status === "fulfilled" ? loops.value : [];
  const started = events.status === "fulfilled" ? events.value : new Map();

  return {
    runs:
      runs.status === "fulfilled"
        ? runs.value.map((run) => {
            const known = started.get(run.id);
            // A run nobody here started was started by a loop, and the loop
            // that owns it is the loop still holding its id.
            const loop = known ? undefined : loopOf(schedules, run.id);
            return {
              id: run.id,
              status: run.status,
              startedAt: run.startedAt,
              stoppedAt: run.stoppedAt,
              finished: run.finished,
              website: known?.website ?? loop?.website_url ?? null,
              by: known?.by ?? (loop ? loop.name : null),
            };
          })
        : [],

    loops: schedules.map((s) => ({
      id: s.id,
      name: s.name,
      enabled: s.enabled,
      mode: s.mode,
      website: s.website_url,
      nextRunAt: s.nextRunAt,
      lastRunAt: s.lastRunAt,
      lastNote: s.lastNote,
    })),

    sites:
      sites.status === "fulfilled"
        ? sites.value.map((site) => ({
            id: site.id,
            name: site.name,
            status: site.status,
            pages: site.pages.length,
            wanted: site.wanted,
            note: site.note,
            updatedAt: site.updatedAt,
            published: site.published
              ? {
                  label: site.published.label || site.published.address,
                  address: site.published.address,
                  at: site.published.at,
                  live: site.published.status === "publish",
                }
              : null,
          }))
        : [],

    notes: {
      runs: runs.status === "rejected" ? why(runs.reason) : null,
      // Loops live only on the engine. On the other backend that is not a
      // failure, it is a section that does not apply, so it says nothing.
      loops:
        loops.status === "rejected" && !(loops.reason instanceof NotOnThisBackend)
          ? why(loops.reason)
          : null,
      sites: sites.status === "rejected" ? why(sites.reason) : null,
    },
  };
}
