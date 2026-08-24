import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type AuditAction =
  | "sign-in"
  | "sign-in-failed"
  | "sign-out"
  | "run-started"
  | "run-failed"
  | "account-created"
  | "run-canceled"
  | "run-cancel-failed";

export type AuditEvent = {
  at: string;
  actor: string;
  action: AuditAction;
  detail: string;
};

export type Backend = "redis" | "file" | "memory";

const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "audit.jsonl");
const KEY = "content-automation:audit";
const CAP = 1000;

// Last resort. A serverless instance keeps this for as long as it happens to
// live, which is not long, so it is a stand-in rather than storage.
const memory: AuditEvent[] = [];

/**
 * Vercel KV and Upstash expose the same REST API under different variable
 * names, and Vercel sets its pair automatically when a store is attached, so
 * accepting both means no configuration in the common case.
 */
function redisConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

async function redis(command: (string | number)[]): Promise<unknown> {
  const config = redisConfig();
  if (!config) throw new Error("No KV configured.");

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`KV returned ${response.status}.`);
  }
  const payload = (await response.json()) as { result?: unknown };
  return payload.result;
}

/** Which store is configured, judged without any network call. */
export function backend(): Backend {
  if (redisConfig()) return "redis";
  return fileBackend();
}

function fileBackend(): Backend {
  try {
    mkdirSync(DIR, { recursive: true });
    return "file";
  } catch {
    return "memory";
  }
}

/**
 * Which store will actually take a write.
 *
 * Configuration alone is not proof: a KV whose variables are present but whose
 * store is deleted, paused or misconfigured fails only at write time, and
 * record() then falls back silently. Reporting "redis" on that basis would tell
 * someone their history was safe while it was being dropped, so this pays for a
 * PING to say something true.
 */
export async function probeBackend(): Promise<Backend> {
  if (redisConfig()) {
    try {
      await redis(["PING"]);
      return "redis";
    } catch {
      // Unreachable: whatever record() would fall back to is the real answer.
    }
  }
  return fileBackend();
}

/**
 * Record one event. Never throws: losing a log line must not take down the
 * action being logged, which would be strictly worse than a gap in the log.
 *
 * Awaited by callers rather than fired and forgotten, because a serverless
 * function can be frozen the moment it responds, which would drop the write.
 */
export async function record(
  actor: string,
  action: AuditAction,
  detail: string
): Promise<void> {
  const event: AuditEvent = {
    at: new Date().toISOString(),
    actor: actor || "anonymous",
    action,
    detail,
  };

  if (redisConfig()) {
    try {
      await redis(["LPUSH", KEY, JSON.stringify(event)]);
      await redis(["LTRIM", KEY, 0, CAP - 1]);
      return;
    } catch {
      // Fall through: a log line is worth keeping somewhere, even briefly.
    }
  }

  try {
    mkdirSync(DIR, { recursive: true });
    appendFileSync(FILE, JSON.stringify(event) + "\n", "utf8");
    return;
  } catch {
    memory.push(event);
    if (memory.length > CAP) memory.splice(0, memory.length - CAP);
  }
}

function parseLine(line: string): AuditEvent | null {
  if (!line.trim()) return null;
  try {
    const parsed = JSON.parse(line) as AuditEvent;
    return parsed && parsed.at && parsed.action ? parsed : null;
  } catch {
    // A torn final line from an interrupted append is skipped, not fatal.
    return null;
  }
}

/** Newest first, from whichever stores hold anything. */
export async function readEvents(limit = 200): Promise<AuditEvent[]> {
  const events: AuditEvent[] = [...memory];

  if (redisConfig()) {
    try {
      const rows = (await redis(["LRANGE", KEY, 0, CAP - 1])) as unknown;
      if (Array.isArray(rows)) {
        for (const row of rows) {
          const event = typeof row === "string" ? parseLine(row) : null;
          if (event) events.push(event);
        }
      }
    } catch {
      // Unreachable KV reads as empty rather than breaking the page.
    }
  }

  try {
    if (existsSync(FILE)) {
      for (const line of readFileSync(FILE, "utf8").split("\n")) {
        const event = parseLine(line);
        if (event) events.push(event);
      }
    }
  } catch {
    // Same.
  }

  const seen = new Set<string>();
  return events
    .filter((e) => {
      // The same event can be in more than one store after a backend change.
      const key = `${e.at}|${e.actor}|${e.action}|${e.detail}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, Math.min(Math.max(limit, 1), CAP));
}
