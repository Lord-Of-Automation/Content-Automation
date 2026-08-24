/**
 * A transcript of what the workflow said to the Claude API and what came back.
 *
 * The Messages API is stateless: every call the workflow makes starts from
 * nothing, so the model has no idea what it was asked ten minutes ago or what
 * it answered. This keeps the last ten prompt/response pairs so the next call
 * can be shown them first and carry on from there rather than beginning cold.
 *
 * Kept per domain, so one site's transcript does not leak into another's. Pass
 * no url and it goes to a shared "global" transcript instead.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { kvConfigured, kvGetJSON, kvSetJSON } from "./kv";
import { normaliseDomain } from "./sites";

/** Ten exchanges, as asked for. */
const CAP = 10;

/**
 * Prompts in this workflow can carry an entire crawled page, and responses run
 * to full articles. Stored whole they would be megabytes and would swamp the
 * very prompt they are meant to inform, so each side is capped and the cut is
 * declared rather than hidden.
 */
const MAX_CHARS = 6000;

const DIR = path.join(process.cwd(), ".data", "memory");

export type Exchange = {
  at: string;
  /** Which workflow node made the call, when it says. */
  node: string;
  /** The page being worked on, for context. */
  url: string;
  prompt: string;
  response: string;
  truncated: boolean;
};

/** Where a transcript lives: a domain, or the shared log. */
export function scopeFor(url: unknown): string {
  const domain = normaliseDomain(String(url ?? ""));
  return domain ?? "global";
}

function keyFor(scope: string): string {
  return `content-automation:transcript:${scope}`;
}

function fileFor(scope: string): string {
  return path.join(DIR, `${scope.replace(/[^a-z0-9.-]/g, "_")}.json`);
}

async function readAll(scope: string): Promise<Exchange[]> {
  if (kvConfigured()) {
    const rows = await kvGetJSON<Exchange[]>(keyFor(scope));
    if (rows) return rows;
  }
  try {
    const file = fileFor(scope);
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Exchange[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // A corrupt transcript reads as empty: it must never block a run.
  }
  return [];
}

async function writeAll(scope: string, rows: Exchange[]): Promise<void> {
  if (kvConfigured()) {
    await kvSetJSON(keyFor(scope), rows);
    return;
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(fileFor(scope), JSON.stringify(rows, null, 2), "utf8");
}

/** Collapses runs of blank lines but keeps the line breaks that carry meaning. */
function tidy(value: unknown): string {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function cap(value: string): { text: string; cut: boolean } {
  if (value.length <= MAX_CHARS) return { text: value, cut: false };
  // Keep the head and the tail: instructions tend to sit at the start and the
  // conclusion at the end, and the middle is usually the bulk being quoted.
  const half = Math.floor(MAX_CHARS / 2);
  return {
    text:
      value.slice(0, half) +
      `\n\n…[${value.length - MAX_CHARS} characters cut]…\n\n` +
      value.slice(-half),
    cut: true,
  };
}

export type RecordResult =
  | { ok: true; scope: string; kept: number }
  | { ok: false; error: string };

export async function recordExchange(input: {
  url?: unknown;
  node?: unknown;
  prompt: unknown;
  response: unknown;
}): Promise<RecordResult> {
  const prompt = tidy(input.prompt);
  const response = tidy(input.response);

  if (!prompt && !response) {
    return { ok: false, error: "Send at least a prompt or a response." };
  }

  const promptCapped = cap(prompt);
  const responseCapped = cap(response);
  const scope = scopeFor(input.url);

  const entry: Exchange = {
    at: new Date().toISOString(),
    node: tidy(input.node).slice(0, 120),
    url: tidy(input.url).slice(0, 500),
    prompt: promptCapped.text,
    response: responseCapped.text,
    truncated: promptCapped.cut || responseCapped.cut,
  };

  const rows = await readAll(scope);
  rows.unshift(entry);
  await writeAll(scope, rows.slice(0, CAP));

  return { ok: true, scope, kept: Math.min(rows.length, CAP) };
}

export async function exchangesFor(url: unknown): Promise<Exchange[]> {
  return readAll(scopeFor(url));
}

/**
 * Markdown, because this is pasted straight into the next prompt and a model
 * reads a headed transcript far better than a nested object. Oldest last so it
 * reads as a conversation running down the page.
 */
export function toMarkdown(scope: string, rows: Exchange[]): string {
  const where = scope === "global" ? "this workflow" : scope;

  if (rows.length === 0) {
    return (
      `# Earlier exchanges for ${where}\n\n` +
      "None yet. This is the first request, so there is nothing to carry forward.\n"
    );
  }

  const lines: string[] = [
    `# Earlier exchanges for ${where}`,
    "",
    `The last ${rows.length} request${rows.length === 1 ? "" : "s"} sent to you ` +
      "and what you replied, oldest first. Treat it as the conversation so far: " +
      "stay consistent with it, do not contradict or repeat it, and then answer " +
      "the new request that follows.",
    "",
  ];

  // Oldest first: newest is at index 0 in storage, which is wrong for reading.
  for (const [index, row] of [...rows].reverse().entries()) {
    const heading = row.node ? `${row.node}` : `Exchange ${index + 1}`;
    lines.push(`## ${index + 1}. ${heading} — ${row.at.slice(0, 16).replace("T", " ")}`);
    if (row.url) lines.push(`Page: ${row.url}`);
    if (row.truncated) lines.push("_Long values were shortened in the middle._");
    lines.push("");
    lines.push("**Asked:**");
    lines.push("");
    lines.push(row.prompt || "_(no prompt recorded)_");
    lines.push("");
    lines.push("**Answered:**");
    lines.push("");
    lines.push(row.response || "_(no response recorded)_");
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

export async function markdownFor(url: unknown): Promise<string> {
  const scope = scopeFor(url);
  return toMarkdown(scope, await readAll(scope));
}

export async function forget(url: unknown): Promise<boolean> {
  const scope = scopeFor(url);
  const rows = await readAll(scope);
  if (rows.length === 0) return false;
  await writeAll(scope, []);
  return true;
}
