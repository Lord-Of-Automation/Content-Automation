import type { BodyClasses } from "./n8n";

/**
 * What the person actually asked for, recovered from the execution payload.
 *
 * Reading it back out of n8n rather than remembering it in the browser means a
 * run opened tomorrow, or started by someone else, still shows its inputs.
 */

export type RunInputs = {
  website_url: string | null;
  market: string | null;
  language: string | null;
  max_crawl_pages: number | null;
  pages_to_optimise: number | null;
  reuse_crawl_days: number | null;
  exclude_paths: string[];
  brief_doc_id: string | null;
  /**
   * Declared body classes, where the backend records them. Always empty on the
   * n8n path, which has never heard of them: reading a run back must not invent
   * declarations that were not made.
   */
  body_classes: BodyClasses;
};

const FIELDS = [
  "website_url",
  "market",
  "language",
  "max_crawl_pages",
  "pages_to_optimise",
  "reuse_crawl_days",
  "exclude_paths",
  "brief_doc_id",
] as const;

function asString(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** The first output item of a node's first run, or null. */
function firstItem(entry: unknown): Record<string, unknown> | null {
  if (!Array.isArray(entry) || entry.length === 0) return null;
  const run = entry[0] as Record<string, unknown> | undefined;
  const data = run?.data as Record<string, unknown> | undefined;
  const main = data?.main as unknown;
  if (!Array.isArray(main)) return null;
  for (const branch of main) {
    if (!Array.isArray(branch)) continue;
    for (const item of branch) {
      const json = (item as Record<string, unknown> | undefined)?.json;
      if (json && typeof json === "object") return json as Record<string, unknown>;
    }
  }
  return null;
}

function score(source: Record<string, unknown>): number {
  return FIELDS.filter((field) => source[field] !== undefined).length;
}

export function extractInputs(
  runData: Record<string, unknown> | undefined
): RunInputs | null {
  if (!runData) return null;

  let best: Record<string, unknown> | null = null;
  let bestScore = 0;

  for (const entry of Object.values(runData)) {
    const json = firstItem(entry);
    if (!json) continue;

    // The Webhook node nests the POST body one level down, while the Form
    // Trigger and the normalising Code node emit the fields flat. Try the body
    // first: it is the untouched submission, before any clamping downstream.
    const body =
      json.body && typeof json.body === "object"
        ? (json.body as Record<string, unknown>)
        : null;

    for (const candidate of [body, json]) {
      if (!candidate) continue;
      const found = score(candidate);
      // The most complete candidate wins, and an earlier node wins a tie, which
      // keeps the trigger ahead of anything that rewrote a field later on.
      if (found > bestScore) {
        best = candidate;
        bestScore = found;
      }
    }
  }

  // One stray field is more likely a coincidence than a submission.
  if (!best || bestScore < 2) return null;

  return {
    website_url: asString(best.website_url),
    market: asString(best.market),
    language: asString(best.language),
    max_crawl_pages: asNumber(best.max_crawl_pages),
    pages_to_optimise: asNumber(best.pages_to_optimise),
    reuse_crawl_days: asNumber(best.reuse_crawl_days),
    exclude_paths: (() => {
      const raw = best.exclude_paths;
      const list = Array.isArray(raw) ? raw : String(raw ?? "").split(/[\n,]/);
      return list.map((v) => String(v).trim()).filter(Boolean);
    })(),
    brief_doc_id: asString(best.brief_doc_id),
    body_classes: {},
  };
}
