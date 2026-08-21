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

  // ---- max_crawl_pages (the workflow hard-clamps this to 1..10)
  const rawPages = input.max_crawl_pages;
  const pages =
    typeof rawPages === "number"
      ? rawPages
      : typeof rawPages === "string"
        ? Number.parseInt(rawPages, 10)
        : Number.NaN;

  if (!Number.isFinite(pages)) {
    errors.max_crawl_pages = "Required.";
  } else if (pages < 1 || pages > 10) {
    errors.max_crawl_pages = "Must be between 1 and 10.";
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
      brief_doc_id: briefDocId,
    },
  };
}
