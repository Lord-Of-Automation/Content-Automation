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
  reuse_crawl_days: number;
  exclude_paths: string;
  brief_doc_id: string;
  /**
   * Whether the run reads the house brief at all.
   *
   * Off by default. The brief shapes the voice of every page a run writes, and
   * it is a deliberate choice rather than something to inherit silently — so
   * the address is kept but not sent unless this is on.
   */
  use_brief: boolean;
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
  reuse_crawl_days: 7, // 0 = always crawl fresh
  exclude_paths: "",
  // Kept so switching the brief on does not mean hunting for the ID again.
  brief_doc_id: DEFAULT_BRIEF_DOC_ID,
  use_brief: false,
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
    // The address is remembered above but withheld here, which is what makes
    // the switch mean anything: the engine skips the brief when it is given no
    // document, so sending a blank one is how "off" is expressed to it.
    const submitted: RunValues = values.use_brief
      ? values
      : { ...values, brief_doc_id: "" };

    if (batch) {
      onSubmitBatch(submitted, urls);
    } else {
      onSubmit(submitted);
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
              Bulk URLs
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

      <div className="field">
        <label htmlFor="exclude_paths">Never optimise</label>
        <input
          id="exclude_paths"
          type="text"
          placeholder="/bonus/, /tag/, /author/"
          value={values.exclude_paths}
          onChange={(e) => set("exclude_paths", e.target.value)}
          aria-invalid={Boolean(fieldErrors.exclude_paths)}
        />
        {fieldErrors.exclude_paths ? (
          <div className="err">{fieldErrors.exclude_paths}</div>
        ) : (
          <div className="note">
            {(() => {
              const list = values.exclude_paths
                .split(/[\n,]/)
                .map((v) => v.trim())
                .filter(Boolean);
              return list.length === 0
                ? "Leave empty to optimise every crawled page. Add path fragments, separated by commas, and any page whose address contains one is skipped."
                : `Skipping any page whose address contains ${list
                    .map((v) => '"' + v + '"')
                    .join(" or ")}. They are still crawled for the link graph, just never written.`;
            })()}
          </div>
        )}
      </div>

      <div className="field">
        <label htmlFor="reuse_crawl_days">Reuse a recent crawl</label>
        <div className="limit-row">
          <label className="check">
            <input
              type="checkbox"
              checked={values.reuse_crawl_days === 0}
              onChange={(e) =>
                set("reuse_crawl_days", e.target.checked ? 0 : 7)
              }
            />
            Always crawl fresh
          </label>
          <input
            id="reuse_crawl_days"
            type="number"
            min={1}
            max={90}
            step={1}
            disabled={values.reuse_crawl_days === 0}
            value={values.reuse_crawl_days === 0 ? "" : values.reuse_crawl_days}
            placeholder="days"
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10);
              set("reuse_crawl_days", Number.isFinite(n) ? n : 0);
            }}
          />
        </div>
        <div className="note">
          {values.reuse_crawl_days === 0
            ? "Every run pays for its own crawl of the whole site, even if the same domain was crawled minutes ago."
            : `If this domain was already crawled in the last ${values.reuse_crawl_days} day${values.reuse_crawl_days === 1 ? "" : "s"}, that crawl is used again instead of paying for a new one. Different pages on one site then share a single crawl.`}
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

      <div className="field">
        <label className="toggle-row" htmlFor="use_brief">
          <input
            id="use_brief"
            type="checkbox"
            checked={values.use_brief}
            onChange={(e) => set("use_brief", e.target.checked)}
          />
          <span>Write in the house voice</span>
        </label>
        <div className="note">
          {values.use_brief
            ? "Every page this run writes is shaped by the brief below."
            : "Off. Pages are written without the brief, in a neutral voice."}
        </div>
      </div>

      {values.use_brief ? (
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
              It must be shared with the service account.
            </div>
          )}
        </div>
      ) : null}

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
