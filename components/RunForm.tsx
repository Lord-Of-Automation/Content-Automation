"use client";

import { useEffect, useState } from "react";

import {
  LANGUAGES,
  MARKETS,
  MARKET_DEFAULT_LANGUAGE,
} from "@/lib/markets";
import { DEFAULT_BRIEF_DOC_ID } from "@/lib/validate";

export type RunValues = {
  website_url: string;
  market: string;
  language: string;
  max_crawl_pages: number;
  brief_doc_id: string;
};

const STORAGE_KEY = "ca:last-input";

export const DEFAULT_VALUES: RunValues = {
  website_url: "",
  market: "gb",
  language: "en",
  max_crawl_pages: 10,
  brief_doc_id: DEFAULT_BRIEF_DOC_ID,
};

export default function RunForm({
  busy,
  fieldErrors,
  onSubmit,
}: {
  busy: boolean;
  fieldErrors: Record<string, string>;
  onSubmit: (values: RunValues) => void;
}) {
  const [values, setValues] = useState<RunValues>(DEFAULT_VALUES);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Restore whatever was run last. Reading localStorage in an effect keeps the
  // server and first client render identical, so there is no hydration warning.
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as Partial<RunValues>;
      setValues((current) => ({ ...current, ...parsed }));
    } catch {
      /* corrupt or unavailable storage is not worth surfacing */
    }
  }, []);

  function set<K extends keyof RunValues>(key: K, value: RunValues[K]) {
    setValues((current) => {
      const next = { ...current, [key]: value };

      // Pair the language to the market, but only while the user has not
      // deliberately picked a language of their own.
      if (key === "market") {
        const suggested = MARKET_DEFAULT_LANGUAGE[value as string];
        const wasAuto =
          current.language === MARKET_DEFAULT_LANGUAGE[current.market];
        if (suggested && wasAuto) next.language = suggested;
      }

      return next;
    });
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
    } catch {
      /* ignore */
    }
    onSubmit(values);
  }

  const singlePage = (() => {
    try {
      const path = new URL(values.website_url).pathname;
      return path !== "" && path !== "/";
    } catch {
      return false;
    }
  })();

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="field">
        <label htmlFor="website_url">Page or site URL</label>
        <input
          id="website_url"
          type="url"
          inputMode="url"
          placeholder="https://example.com/casino/brand-review/"
          value={values.website_url}
          onChange={(e) => set("website_url", e.target.value)}
          aria-invalid={Boolean(fieldErrors.website_url)}
          required
        />
        {fieldErrors.website_url ? (
          <div className="err">{fieldErrors.website_url}</div>
        ) : (
          <div className="note">
            {values.website_url === ""
              ? "A bare domain optimises every crawled page. A full URL optimises just that one."
              : singlePage
                ? "Single page mode: the whole site is still crawled for the link graph, but only this page is rewritten."
                : "Whole site mode: every crawled page gets optimised, up to the crawl limit."}
          </div>
        )}
      </div>

      <div className="row-2">
        <div className="field">
          <label htmlFor="market">Market</label>
          <select
            id="market"
            value={values.market}
            onChange={(e) => set("market", e.target.value)}
          >
            {MARKETS.map((m) => (
              <option key={m.code} value={m.code}>
                {m.label} ({m.code})
              </option>
            ))}
          </select>
          {fieldErrors.market ? (
            <div className="err">{fieldErrors.market}</div>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="language">Language</label>
          <select
            id="language"
            value={values.language}
            onChange={(e) => set("language", e.target.value)}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} ({l.code})
              </option>
            ))}
          </select>
          {fieldErrors.language ? (
            <div className="err">{fieldErrors.language}</div>
          ) : null}
        </div>
      </div>

      <div className="field">
        <label htmlFor="max_crawl_pages">Crawl limit</label>
        <div className="range-row">
          <input
            id="max_crawl_pages"
            type="range"
            min={1}
            max={10}
            step={1}
            value={values.max_crawl_pages}
            onChange={(e) =>
              set("max_crawl_pages", Number.parseInt(e.target.value, 10))
            }
          />
          <span className="range-val">{values.max_crawl_pages}</span>
        </div>
        <div className="note">
          Pages DataForSEO crawls. The workflow clamps this to 10 regardless, so
          the slider stops there.
        </div>
      </div>

      {showAdvanced ? (
        <div className="field">
          <label htmlFor="brief_doc_id">Brief doc ID</label>
          <input
            id="brief_doc_id"
            type="text"
            className="mono"
            value={values.brief_doc_id}
            onChange={(e) => set("brief_doc_id", e.target.value)}
            aria-invalid={Boolean(fieldErrors.brief_doc_id)}
          />
          {fieldErrors.brief_doc_id ? (
            <div className="err">{fieldErrors.brief_doc_id}</div>
          ) : (
            <div className="note">
              Google Drive file ID of the house brief. The ID only, not the URL.
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="btn-link"
          onClick={() => setShowAdvanced(true)}
          style={{ marginBottom: 15 }}
        >
          Use a different brief doc
        </button>
      )}

      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Starting…" : "Start run"}
      </button>
    </form>
  );
}
