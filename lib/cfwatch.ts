/**
 * Watching a newly added zone until Cloudflare notices the name servers.
 *
 * A zone created through the API sits in "pending" and does nothing. It becomes
 * active only once Cloudflare's own checks see the new name servers at the
 * registry, which takes anywhere from a minute to a few hours depending on the
 * extension. Nothing tells us when; the only way to know is to look.
 *
 * So a zone goes on this list when it is created, and gets looked at every few
 * minutes for an hour. An hour because that covers the ordinary case and a
 * watcher that never gives up is a watcher that polls a mistake forever — a
 * domain whose name servers were never actually changed will sit pending until
 * somebody changes them, and no amount of checking hurries that along. Giving
 * up is not a failure: the status column still reads the truth from Cloudflare
 * every time the page loads.
 *
 * The looking happens on two triggers, neither of which is a background process
 * this app has. Opening the Domains page sweeps it, and so does a scheduled
 * call to the same route. Both are cheap and idempotent.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { kvConfigured, kvGetJSON, kvSetJSON } from "./kv";
import { getZone } from "./cloudflare";

const KEY = "content-automation:cfwatch";
const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "cfwatch.json");

/** How long to keep asking, and how often. */
const WINDOW_MS = 60 * 60 * 1000;
const EVERY_MS = 5 * 60 * 1000;

export interface Watch {
  domain: string;
  zoneId: string;
  /** When the zone was created here. */
  since: string;
  /** When it was last asked about. */
  checkedAt: string | null;
  /** Set once Cloudflare says active. */
  activeAt: string | null;
  /** True once the hour is up without activation. */
  gaveUp: boolean;
}

async function read(): Promise<Watch[]> {
  if (kvConfigured()) {
    const rows = await kvGetJSON<Watch[]>(KEY);
    if (Array.isArray(rows)) return rows;
  }
  try {
    if (existsSync(FILE)) {
      const parsed = JSON.parse(readFileSync(FILE, "utf8")) as Watch[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    /* a corrupt file is an empty watch list, not a broken page */
  }
  return [];
}

async function write(rows: Watch[]): Promise<void> {
  if (kvConfigured()) {
    await kvSetJSON(KEY, rows);
    return;
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(rows, null, 2), "utf8");
}

export async function watchZone(domain: string, zoneId: string): Promise<void> {
  const rows = (await read()).filter((r) => r.domain !== domain);
  rows.push({
    domain: domain.toLowerCase(),
    zoneId,
    since: new Date().toISOString(),
    checkedAt: null,
    activeAt: null,
    gaveUp: false,
  });
  // Old entries are dropped as they are written past, so the list stays the
  // size of what is genuinely in flight rather than a log of everything ever
  // added.
  await write(rows.filter((r) => !r.activeAt).slice(-200));
}

export async function listWatches(): Promise<Watch[]> {
  return read();
}

/**
 * Asks Cloudflare about everything due a check.
 *
 * Returns what changed, so a caller can say so. Safe to call as often as
 * anybody likes: the interval is enforced here rather than by the caller, so a
 * page that loads twice in a minute makes one round of requests at most.
 */
export async function sweep(): Promise<{ checked: number; activated: string[] }> {
  const rows = await read();
  if (!rows.length) return { checked: 0, activated: [] };

  const now = Date.now();
  const activated: string[] = [];
  let checked = 0;
  let touched = false;

  for (const row of rows) {
    if (row.activeAt || row.gaveUp) continue;

    const last = row.checkedAt ? Date.parse(row.checkedAt) : 0;
    if (now - last < EVERY_MS) continue;

    checked += 1;
    touched = true;
    row.checkedAt = new Date(now).toISOString();

    try {
      const zone = await getZone(row.domain);
      if (zone?.status === "active") {
        row.activeAt = zone.activatedOn ?? new Date(now).toISOString();
        activated.push(row.domain);
        continue;
      }
    } catch {
      // A failed check is not an answer. It counts as a check so the interval
      // still applies, and the hour still runs out, but it must not be read as
      // "not active" — the status column asks Cloudflare directly anyway.
    }

    if (now - Date.parse(row.since) > WINDOW_MS) row.gaveUp = true;
  }

  if (touched) await write(rows.filter((r) => !r.activeAt));
  return { checked, activated };
}
