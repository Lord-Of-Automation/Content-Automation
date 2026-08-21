import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

export type AuditAction =
  | "sign-in"
  | "sign-in-failed"
  | "sign-out"
  | "run-started"
  | "run-failed";

export type AuditEvent = {
  at: string;
  actor: string;
  action: AuditAction;
  detail: string;
};

const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "audit.jsonl");
const MEMORY_CAP = 500;

// Populated only when the filesystem refuses writes, which is the normal case on
// Vercel: its runtime filesystem is read-only, so a deployed instance keeps the
// log in memory and loses it when the instance recycles. Locally the file wins.
const memory: AuditEvent[] = [];
let persistent = true;

/** True when events are reaching disk rather than a per-instance buffer. */
export function isPersistent(): boolean {
  return persistent;
}

/**
 * Record one event. Never throws: an audit failure must not take down the action
 * being audited, which would be a strictly worse outcome than a missing line.
 */
export function record(
  actor: string,
  action: AuditAction,
  detail: string
): void {
  const event: AuditEvent = {
    at: new Date().toISOString(),
    actor: actor || "anonymous",
    action,
    detail,
  };

  try {
    mkdirSync(DIR, { recursive: true });
    appendFileSync(FILE, JSON.stringify(event) + "\n", "utf8");
  } catch {
    persistent = false;
    memory.push(event);
    if (memory.length > MEMORY_CAP) memory.splice(0, memory.length - MEMORY_CAP);
  }
}

/** Newest first. Reads whichever stores actually hold anything. */
export function readEvents(limit = 200): AuditEvent[] {
  const events: AuditEvent[] = [...memory];

  try {
    if (existsSync(FILE)) {
      for (const line of readFileSync(FILE, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as AuditEvent;
          if (parsed && parsed.at && parsed.action) events.push(parsed);
        } catch {
          // A torn final line from a crashed append is skipped, not fatal.
        }
      }
    }
  } catch {
    // Unreadable log is reported as empty rather than breaking the page.
  }

  return events
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, Math.min(Math.max(limit, 1), 1000));
}
