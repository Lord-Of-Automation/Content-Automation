/**
 * What the workflow has already written for a site.
 *
 * Every Claude call in the workflow starts blank, so run twenty knows nothing
 * of runs one to nineteen and the writing drifts: the same angle gets used
 * twice, the same headings reappear, the tone wanders. This keeps a short
 * rolling record per domain that the drafting step reads first.
 *
 * Per domain rather than global, so one client's phrasing does not bleed into
 * another's pages. Changing that means changing the key and nothing else.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { kvConfigured, kvGetJSON, kvSetJSON } from "./kv";
import { normaliseDomain } from "./sites";

/** Ten is enough to steer the next piece without swamping the prompt. */
const CAP = 10;

const DIR = path.join(process.cwd(), ".data", "memory");

export type MemoryEntry = {
  at: string;
  url: string;
  title: string;
  /** What the page set out to do, in a sentence or two. */
  summary: string;
  headings: string[];
  /** Anything the next run should avoid repeating or should follow. */
  notes: string;
};

function keyFor(domain: string): string {
  return `content-automation:memory:${domain}`;
}

function fileFor(domain: string): string {
  // One file per domain, named safely regardless of what the domain contains.
  return path.join(DIR, `${domain.replace(/[^a-z0-9.-]/g, "_")}.json`);
}

async function readAll(domain: string): Promise<MemoryEntry[]> {
  if (kvConfigured()) {
    const rows = await kvGetJSON<MemoryEntry[]>(keyFor(domain));
    if (rows) return rows;
  }
  try {
    const file = fileFor(domain);
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as MemoryEntry[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // Corrupt history reads as none: it must never block a run.
  }
  return [];
}

async function writeAll(domain: string, rows: MemoryEntry[]): Promise<void> {
  if (kvConfigured()) {
    await kvSetJSON(keyFor(domain), rows);
    return;
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(fileFor(domain), JSON.stringify(rows, null, 2), "utf8");
}

/**
 * Identifies a page across the spellings the same page arrives in: with and
 * without www, upper and lower case host, trailing slash or not, query and
 * fragment attached. Comparing raw urls let one page be stored twice.
 */
function pageKey(url: string): string | null {
  try {
    const parsed = new URL(url.includes("://") ? url : `https://${url}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const route = parsed.pathname.replace(/\/+$/, "").toLowerCase() || "/";
    return host + route;
  } catch {
    return null;
  }
}

function clean(value: unknown, limit: number): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export type RememberResult =
  | { ok: true; domain: string; kept: number }
  | { ok: false; error: string };

export async function remember(input: {
  url: unknown;
  title: unknown;
  summary: unknown;
  headings: unknown;
  notes: unknown;
}): Promise<RememberResult> {
  const domain = normaliseDomain(String(input.url ?? ""));
  if (!domain) return { ok: false, error: "A url on a real domain is required." };

  const entry: MemoryEntry = {
    at: new Date().toISOString(),
    url: clean(input.url, 500),
    title: clean(input.title, 300),
    summary: clean(input.summary, 1200),
    headings: Array.isArray(input.headings)
      ? input.headings.map((h) => clean(h, 200)).filter(Boolean).slice(0, 30)
      : [],
    notes: clean(input.notes, 1200),
  };

  const rows = await readAll(domain);

  // Re-running the same page replaces its entry rather than stacking a second
  // one, so the record reflects what is live and not every attempt at it.
  const key = pageKey(entry.url);
  const existing = rows.findIndex(
    (r) => r.url === entry.url || (key !== null && pageKey(r.url) === key)
  );
  if (existing >= 0) rows.splice(existing, 1);

  rows.unshift(entry);
  await writeAll(domain, rows.slice(0, CAP));

  return { ok: true, domain, kept: Math.min(rows.length, CAP) };
}

export async function entriesFor(url: string): Promise<MemoryEntry[]> {
  const domain = normaliseDomain(url);
  if (!domain) return [];
  return readAll(domain);
}

/**
 * Markdown rather than JSON because this is dropped straight into a prompt,
 * where a model reads headed prose far better than it reads a nested object.
 */
export function toMarkdown(domain: string, rows: MemoryEntry[]): string {
  if (rows.length === 0) {
    return (
      `# Previous work on ${domain}\n\n` +
      "Nothing has been published here yet. This is the first page.\n"
    );
  }

  const lines: string[] = [
    `# Previous work on ${domain}`,
    "",
    `The ${rows.length} most recent page${rows.length === 1 ? "" : "s"} published ` +
      "here, newest first. Do not repeat these angles or reuse these headings; " +
      "match the established tone and link to them where it genuinely helps.",
    "",
  ];

  for (const row of rows) {
    lines.push(`## ${row.title || row.url}`);
    lines.push(`- Page: ${row.url}`);
    lines.push(`- Published: ${row.at.slice(0, 10)}`);
    if (row.summary) lines.push(`- Angle taken: ${row.summary}`);
    if (row.headings.length > 0) {
      lines.push(`- Headings used: ${row.headings.join(" · ")}`);
    }
    if (row.notes) lines.push(`- Notes: ${row.notes}`);
    lines.push("");
  }

  return lines.join("\n");
}

export async function markdownFor(url: string): Promise<string> {
  const domain = normaliseDomain(url);
  if (!domain) return "# Previous work\n\nNo domain could be read from that url.\n";
  return toMarkdown(domain, await readAll(domain));
}

export async function forget(url: string): Promise<boolean> {
  const domain = normaliseDomain(url);
  if (!domain) return false;
  const rows = await readAll(domain);
  if (rows.length === 0) return false;
  await writeAll(domain, []);
  return true;
}
