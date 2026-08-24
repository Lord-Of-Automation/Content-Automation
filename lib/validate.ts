import { LANGUAGE_CODES, MARKET_CODES } from "./markets";
import type { StartRunInput } from "./n8n";

export const DEFAULT_BRIEF_DOC_ID = "1TesrkPHHJRHq0Gmb6keRrY-TdrWJ_u3QDFwNWOpwR6s";

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

  // ---- brief_doc_id
  const briefDocId =
    typeof input.brief_doc_id === "string" && input.brief_doc_id.trim()
      ? input.brief_doc_id.trim()
      : DEFAULT_BRIEF_DOC_ID;

  if (/[/\s]/.test(briefDocId)) {
    errors.brief_doc_id =
      "Use the Drive file ID only, not the full document URL.";
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
      brief_doc_id: briefDocId,
    },
  };
}
