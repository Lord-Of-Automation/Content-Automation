"use client";

import { useEffect, useState } from "react";

import {
  LANGUAGES,
  MARKETS,
  MARKET_DEFAULT_LANGUAGE,
} from "@/lib/markets";
import { forecastCost } from "@/lib/forecast";
import { DEFAULT_BRIEF_DOC_ID } from "@/lib/validate";

function money(value: number): string {
  return value < 10 ? "$" + value.toFixed(2) : "$" + Math.round(value);
}

export type RunValues = {
  website_url: string;
  market: string;
  language: string;
  max_crawl_pages: number;
  pages_to_optimise: number;
  brief_doc_id: string;
};

const STORAGE_KEY = "ca:last-input";

/**
 * One URL per line is the obvious way to paste a list, but people paste from
 * spreadsheets and comma-separated notes too, so split on any of it.
 */
export function parseUrlList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/[\s,;]+/)) {
    const url = piece.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export const DEFAULT_VALUES: RunValues = {
  website_url: "",
  market: "gb",
  language: "en",
  max_crawl_pages: 0, // 0 = every page
  pages_to_optimise: 1,
  brief_doc_id: DEFAULT_BRIEF_DOC_ID,
};

export default function RunForm({
  busy,
  fieldErrors,
  onSubmit,
  onSubmitBatch,
}: {
  busy: boolean;
  fieldErrors: Record<string, string>;
  onSubmit: (values: RunValues) => void;
  onSubmitBatch: (values: RunValues, urls: string[]) => void;
}) {
  const [values, setValues] = useState<RunValues>(DEFAULT_VALUES);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [batch, setBatch] = useState(false);
  const [urlList, setUrlList] = useState("");

  const urls = parseUrlList(urlList);

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
    if (batch) {
      onSubmitBatch(values, urls);
    } else {
      onSubmit(values);
    }
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
        <div className="field-head">
          <label htmlFor={batch ? "url_list" : "website_url"}>
            {batch ? "Pages or site URLs" : "Page or site URL"}
          </label>
          <div className="seg seg-sm">
            <button
              type="button"
              className={batch ? "seg-btn" : "seg-btn is-on"}
              onClick={() => setBatch(false)}
            >
              One
            </button>
            <button
              type="button"
              className={batch ? "seg-btn is-on" : "seg-btn"}
              onClick={() => setBatch(true)}
            >
              Several
            </button>
          </div>
        </div>

        {batch ? (
          <>
            <textarea
              id="url_list"
              rows={6}
              className="url-list"
              placeholder={"https://example.com/casino/one-review/\nhttps://example.com/casino/two-review/"}
              value={urlList}
              onChange={(e) => setUrlList(e.target.value)}
              required
            />
            <div className="note">
              One per line. Every URL uses the settings below, and each becomes
              its own run that n8n queues and works through on its own &mdash;
              nothing needs to stay open here.
              {urls.length > 0 ? (
                <>
                  {" "}
                  <strong>
                    {urls.length} URL{urls.length === 1 ? "" : "s"}
                  </strong>{" "}
                  ready.
                </>
              ) : null}
            </div>
          </>
        ) : (
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
        )}

        {!batch && fieldErrors.website_url ? (
          <div className="err">{fieldErrors.website_url}</div>
        ) : !batch ? (
          <div className="note">
            {values.website_url === ""
              ? "A bare domain optimises every crawled page. A full URL optimises just that one."
              : singlePage
                ? "Single page mode: the whole site is still crawled for the link graph, but only this page is rewritten."
                : "Whole site mode: every crawled page gets optimised, up to the crawl limit."}
          </div>
        ) : null}
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
        <div className="limit-row">
          <label className="check">
            <input
              type="checkbox"
              checked={values.max_crawl_pages === 0}
              onChange={(e) =>
                set("max_crawl_pages", e.target.checked ? 0 : 10)
              }
            />
            Every page
          </label>
          <input
            id="max_crawl_pages"
            type="number"
            min={1}
            max={1000}
            step={1}
            disabled={values.max_crawl_pages === 0}
            value={values.max_crawl_pages === 0 ? "" : values.max_crawl_pages}
            placeholder="every page"
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              set("max_crawl_pages", Number.isFinite(n) ? n : 0);
            }}
          />
        </div>
        <div className="note">
          Pages DataForSEO crawls. Leave it on Every page to crawl the whole
          site, or untick and enter a number. 1000 is the API ceiling, so
          Every page means every page up to that.
        </div>
      </div>

      <div className="field field-sep">
        <label htmlFor="pages_to_optimise">Pages to optimise</label>
        <div className="limit-row">
          <label className="check">
            <input
              type="checkbox"
              checked={values.pages_to_optimise === 0}
              onChange={(e) =>
                set("pages_to_optimise", e.target.checked ? 0 : 1)
              }
            />
            All crawled pages
          </label>
          <input
            id="pages_to_optimise"
            type="number"
            min={1}
            max={1000}
            step={1}
            disabled={values.pages_to_optimise === 0}
            value={values.pages_to_optimise === 0 ? "" : values.pages_to_optimise}
            placeholder="all"
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              set("pages_to_optimise", Number.isFinite(n) ? n : 0);
            }}
          />
        </div>
        <div className="note">
          How many crawled pages get an article written and published. Every
          page here costs Claude, Gemini and DataForSEO credits and creates a
          WordPress post, so raise it deliberately.
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

      {(() => {
        // Recomputed on every keystroke, so the number reacts to the two fields
        // that actually drive it before anything is spent.
        const forecast = forecastCost(values);
        // Every URL is a full run, so the batch costs its own estimate times
        // however many were pasted.
        const count = batch ? Math.max(urls.length, 0) : 1;
        const low = forecast.low * count;
        const high = forecast.high * count;
        return (
          <div className={forecast.unbounded ? "forecast is-open" : "forecast"}>
            <div className="forecast-row">
              <span className="forecast-label">Estimated cost</span>
              <span className="forecast-amount">
                {money(low)} &ndash; {money(high)}
                {forecast.unbounded ? "+" : ""}
              </span>
            </div>
            <p className="forecast-note">
              {batch && count > 1 ? `${count} runs. ` : ""}
              {forecast.note}
            </p>
          </div>
        );
      })()}

      <button
        type="submit"
        className="btn-primary"
        disabled={busy || (batch && urls.length === 0)}
      >
        {busy
          ? "Starting…"
          : batch
            ? `Start ${urls.length || ""} run${urls.length === 1 ? "" : "s"}`.replace("  ", " ")
            : "Start run"}
      </button>
    </form>
  );
}
