import { LANGUAGE_CODES, MARKET_CODES } from "./markets";
import type { BodyClasses, StartRunInput } from "./n8n";

/** The page classes a run can declare body classes for. */
export const DECLARABLE_CLASSES = [
  "casino_review",
  "game_review",
  "promocodes",
  "blog",
] as const;

export type DeclarableClass = (typeof DECLARABLE_CLASSES)[number];

/**
 * A class attribute is space separated, so pasting one straight out of a page
 * is the obvious thing to do and has to work. Commas and newlines too, since a
 * list typed by hand arrives as either.
 *
 * A leading dot is dropped: copying a selector out of devtools gives you
 * `.single-casino`, and silently never matching would be a miserable way to
 * find that out.
 */
export function parseBodyClassList(raw: unknown): string[] {
  const pieces = Array.isArray(raw)
    ? raw.map((v) => String(v ?? ""))
    : String(raw ?? "").split(/[\s,]+/);

  const names: string[] = [];
  for (const piece of pieces) {
    const name = piece.trim().toLowerCase().replace(/^\.+/, "");
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * The house brief, offered as the default when a run switches it on.
 *
 * Not applied to a run that leaves it off: this is what the form prefills, not
 * a fallback the validator substitutes.
 *
 * This must be a *native* Google Doc. The previous default was an uploaded
 * .docx, which Drive will not export as text — so the workflow downloaded the
 * zip, ran a plain-text extractor over its compressed bytes, and fed the model
 * 2.34 MB of noise instead of the brief. Nothing ever followed the house voice
 * as a result, and that one file was 62% of a run's entire payload.
 */
export const DEFAULT_BRIEF_DOC_ID = "19ohOWLCc7JP6A8goVJMD3a5DXxKa4oUAt-P9-UevTn8";

export type ValidationResult =
  | { ok: true; value: StartRunInput }
  | { ok: false; errors: Record<string, string> };

export function validateRunInput(raw: unknown): ValidationResult {
  const errors: Record<string, string> = {};
  const input = (raw ?? {}) as Record<string, unknown>;

  // ---- website_url
  const url = typeof input.website_url === "string" ? input.website_url.trim() : "";
  if (!url) {
    errors.website_url = "Required.";
  } else {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        errors.website_url = "Must be an http or https URL.";
      }
    } catch {
      errors.website_url = "That is not a valid URL. Include https://";
    }
  }

  // ---- market
  const market = typeof input.market === "string" ? input.market.trim().toLowerCase() : "";
  if (!market) {
    errors.market = "Required.";
  } else if (!MARKET_CODES.has(market)) {
    errors.market = "Unsupported market. The workflow would fall back to the US.";
  }

  // ---- language
  const language =
    typeof input.language === "string" ? input.language.trim().toLowerCase() : "";
  if (!language) {
    errors.language = "Required.";
  } else if (!LANGUAGE_CODES.has(language)) {
    errors.language = "Unsupported language code.";
  }

  // ---- max_crawl_pages (0 means every page; 1000 is DataForSEO's ceiling)
  const rawPages = input.max_crawl_pages;
  const pages =
    typeof rawPages === "number"
      ? rawPages
      : typeof rawPages === "string"
        ? Number.parseInt(rawPages, 10)
        : Number.NaN;

  if (!Number.isFinite(pages)) {
    errors.max_crawl_pages = "Required.";
  } else if (pages < 0 || pages > 1000) {
    errors.max_crawl_pages = "Use 0 for every page, or a number up to 1000.";
  }

  // ---- pages_to_optimise (0 means every crawled page)
  const rawOptimise = input.pages_to_optimise;
  const optimise =
    typeof rawOptimise === "number"
      ? rawOptimise
      : typeof rawOptimise === "string"
        ? Number.parseInt(rawOptimise, 10)
        : Number.NaN;

  if (!Number.isFinite(optimise)) {
    errors.pages_to_optimise = "Required.";
  } else if (optimise < 0 || optimise > 1000) {
    errors.pages_to_optimise =
      "Use 0 for every crawled page, or a number up to 1000.";
  }

  // ---- reuse_crawl_days (0 means always crawl fresh)
  const rawReuse = input.reuse_crawl_days;

  // Absent is not an error: callers written before this field still work, and
  // they get the default. A value that was actually supplied is held to the
  // rules, so a typo cannot quietly turn into "reuse a week-old crawl".
  const reuseOmitted =
    rawReuse === undefined || rawReuse === null || rawReuse === "";

  let reuseDays = 7;
  if (!reuseOmitted) {
    const parsed =
      typeof rawReuse === "number" ? rawReuse : Number(String(rawReuse).trim());
    if (!Number.isFinite(parsed)) {
      errors.reuse_crawl_days = "Enter a number of days, or 0 to always crawl fresh.";
    } else if (parsed < 0 || parsed > 90) {
      errors.reuse_crawl_days = "Use 0 to always crawl fresh, or up to 90 days.";
    } else {
      reuseDays = Math.trunc(parsed);
    }
  }

  // ---- exclude_paths
  //
  // Free text, because the shapes people want to skip are not a fixed list.
  // Split on lines and commas, since a pasted list arrives as either.
  const rawExclude = input.exclude_paths;
  const excludeList: string[] = Array.isArray(rawExclude)
    ? rawExclude.map((v) => String(v))
    : String(rawExclude ?? "").split(/[\n,]/);

  const excludePaths: string[] = [];
  for (const entry of excludeList) {
    const value = entry.trim();
    if (!value) continue;
    if (value.length > 200) {
      errors.exclude_paths = "One of those is too long to be a path.";
      break;
    }
    // Matching is on the address, so a full URL works as well as a fragment.
    if (!excludePaths.includes(value)) excludePaths.push(value);
  }

  if (excludePaths.length > 50) {
    errors.exclude_paths = "That is more than 50 patterns. Use fewer, broader ones.";
  }

  // ---- brief_doc_id
  //
  // Blank means blank. It used to fall back to the house brief, which made
  // "no brief" impossible to express: the run form can now switch the brief
  // off, and a substituted default would have made that switch do nothing
  // while appearing to work. The engine already treats an absent document as
  // "write without a brief".
  const briefDocId =
    typeof input.brief_doc_id === "string" ? input.brief_doc_id.trim() : "";

  if (briefDocId && /[/\s]/.test(briefDocId)) {
    errors.brief_doc_id =
      "Use the Drive file ID only, not the full document URL.";
  }

  // ---- body_classes
  //
  // Optional throughout. The interesting check is not the shape of a class
  // name but whether the same one was declared for two page types: that cannot
  // identify either, and the engine responds by ignoring both, so it is worth
  // saying before the run is paid for rather than in the log afterwards.
  const rawClasses = (input.body_classes ?? {}) as Record<string, unknown>;
  const bodyClasses: BodyClasses = {};
  const declaredBy = new Map<string, DeclarableClass>();

  for (const key of DECLARABLE_CLASSES) {
    const names = parseBodyClassList(rawClasses[key]);
    if (!names.length) continue;

    if (names.some((n) => n.length > 80)) {
      errors[`body_classes.${key}`] = "That is too long to be a class name.";
      continue;
    }

    for (const name of names) {
      const already = declaredBy.get(name);
      if (already && already !== key) {
        errors[`body_classes.${key}`] =
          `"${name}" is already declared for ${already.replace("_", " ")}. ` +
          "A class on two kinds of page identifies neither.";
      }
      declaredBy.set(name, key);
    }

    bodyClasses[key] = names.slice(0, 25);
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      website_url: url,
      market,
      language,
      max_crawl_pages: Math.trunc(pages),
      pages_to_optimise: Math.trunc(optimise),
      reuse_crawl_days: reuseDays,
      exclude_paths: excludePaths,
      brief_doc_id: briefDocId,
      body_classes: bodyClasses,
    },
  };
}
