/**
 * Loops: runs that start themselves, on the engine.
 *
 * Thin on purpose. The schedule lives on the droplet — it is the thing that is
 * always awake, and it owns the queue a firing joins — so this is a pass-through
 * and the rules live there. Duplicating the clamps here would mean two places
 * to disagree about what "every 200 hours" means.
 *
 * Engine only. n8n has no idea what a schedule is, and pretending otherwise by
 * returning an empty list would read as "you have no loops" rather than "loops
 * do not exist on this backend".
 */

import { backend } from "./backend";
import type { BodyClasses } from "./n8n";

export type RunMode = "optimise" | "gap";

export type Schedule = {
  id: string;
  name: string;
  enabled: boolean;
  mode: RunMode;

  website_url: string;
  market: string;
  language: string;
  max_crawl_pages: number;
  pages_to_optimise: number;
  reuse_crawl_days: number;
  exclude_paths: string[];
  brief_doc_id: string;
  body_classes: BodyClasses;
  /** The competitor crawl export a gap loop works from. */
  ideas_sheet_id: string;
  /** A page whose look new pages copy. Blank lets the run find its own. */
  style_reference_url: string;
  /** Whether pages this loop creates go live, or wait as drafts. */
  publish_new_pages: boolean;

  wp_username: string;
  /** The password itself never leaves the engine. */
  wp_password_set: boolean;

  everyHours: number;
  atHour: number;
  atMinute: number;

  createdAt: string;
  nextRunAt: string;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastNote: string | null;
};

export class NotOnThisBackend extends Error {}

function requireEngine(): void {
  if (backend() !== "engine") {
    throw new NotOnThisBackend(
      "Loops run on the engine, and this deployment is pointed at n8n. " +
        "Set RUN_BACKEND=engine and redeploy.",
    );
  }
}

function base(): string {
  const url = process.env.ENGINE_URL?.trim();
  if (!url) throw new Error("ENGINE_URL is not set.");
  return url.replace(/\/+$/, "");
}

function token(): string {
  const value = process.env.ENGINE_TOKEN?.trim();
  if (!value) throw new Error("ENGINE_TOKEN is not set.");
  return value;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  requireEngine();

  const response = await fetch(`${base()}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token()}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });

  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { error: text.slice(0, 300) };
  }

  if (!response.ok) {
    throw new Error(body?.error ?? `The engine answered ${response.status}.`);
  }
  return body as T;
}

export async function listSchedules(): Promise<Schedule[]> {
  const { schedules } = await call<{ schedules: Schedule[] }>("/schedules");
  return schedules ?? [];
}

export async function saveSchedule(input: Record<string, unknown>): Promise<Schedule> {
  const { schedule } = await call<{ schedule: Schedule }>("/schedules", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return schedule;
}

export async function deleteSchedule(id: string): Promise<void> {
  await call(`/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Fires one now, without moving when it next fires on its own. */
export async function runScheduleNow(id: string): Promise<{ id: string }> {
  return call<{ id: string }>(`/schedules/${encodeURIComponent(id)}/run`, { method: "POST" });
}
