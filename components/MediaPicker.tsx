"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { MediaItem } from "@/lib/wordpress";

/**
 * Choosing a picture, from where the pictures are.
 *
 * A site's images live in its own WordPress library, which is where uploads go
 * and where they are chosen from. The console keeps none: every generated site
 * is published into WordPress, and WordPress has had a media library, thumbnails
 * and srcset for years. A second copy here would be two places to keep in step,
 * a bill, and pictures served from somewhere other than the page showing them.
 *
 * What that costs is that a site with nowhere to be published has nowhere to
 * put a picture either. So this says so, in as many words, with the way to fix
 * it — rather than offering an upload that could only fail.
 */

interface Answer {
  connected: boolean;
  why?: "not-published" | "no-login";
  domain?: string;
  where?: string;
  limit?: number;
  items?: MediaItem[];
  pages?: number;
  error?: string;
}

export default function MediaPicker({
  websiteId,
  onPick,
  onPublish,
  onClose,
}: {
  websiteId: string;
  /** The address and description of what was chosen. */
  onPick: (src: string, alt: string) => void;
  /** The way to the Publish tab, for a site that has nowhere to put a picture. */
  onPublish: () => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<Answer | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alt, setAlt] = useState("");
  const [url, setUrl] = useState("");
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(
        `/api/websites/${websiteId}/media?search=${encodeURIComponent(search)}&page=${page}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as Answer;
      if (!response.ok) throw new Error(payload.error ?? `The library returned ${response.status}.`);
      setState(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The library could not be read.");
      setState({ connected: false, why: "no-login" });
    }
  }, [websiteId, search, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send(chosen: File) {
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("file", chosen);
      if (alt.trim()) body.append("alt", alt.trim());

      const response = await fetch(`/api/websites/${websiteId}/media`, { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The upload returned ${response.status}.`);

      const made = payload.item as MediaItem;
      onPick(made.url, made.alt || alt.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "That picture could not be added.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="media-veil" onPointerDown={onClose}>
      <div
        className="media-box"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a picture"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="media-head">
          <h3>{state?.connected ? "Pictures on this site" : "Add a picture"}</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>

        {error ? <p className="notice bad">{error}</p> : null}

        {state === null ? (
          <p className="empty">Looking...</p>
        ) : !state.connected ? (
          /*
           * The one thing this cannot do, said plainly.
           *
           * A picture has to live somewhere, and the somewhere is the site's own
           * WordPress library. Until the site has been published there is no
           * library to put one in, and no address the picture could be served
           * from afterwards.
           */
          <div className="media-blocked">
            <div className="media-blocked-mark" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                <rect x="3" y="4" width="18" height="14" rx="2" />
                <circle cx="8.5" cy="9.5" r="1.6" />
                <path d="M21 15l-5-5-5.5 5.5L8 13l-5 5" />
              </svg>
            </div>

            <h4>
              {state.why === "no-login"
                ? "This site has no WordPress login saved"
                : "This website is not hosted yet"}
            </h4>

            <p>
              {state.why === "no-login" ? (
                <>
                  It was published to <strong>{state.domain}</strong>, but the
                  login for that site is missing, so its picture library cannot
                  be opened.
                </>
              ) : (
                <>
                  Pictures live in the WordPress library of the site this website
                  is published to. Until it is published there is nowhere to put
                  one, and no address it could be served from afterwards.
                </>
              )}
            </p>

            <div className="media-blocked-do">
              <button type="button" className="btn btn-primary" onClick={onPublish}>
                {state.why === "no-login" ? "Connect it on the Publish tab" : "Publish it first"}
              </button>
            </div>

            <p className="provider-hint">
              A picture already on the web can still be used by its address.
            </p>

            <div className="media-url">
              <label className="field-label" htmlFor="media-url">
                Picture address
              </label>
              <input
                id="media-url"
                type="text"
                value={url}
                placeholder="https://example.com/photo.jpg"
                onChange={(e) => setUrl(e.target.value)}
              />
              <label className="field-label" htmlFor="media-url-alt">
                Describe it, for anyone who cannot see it
              </label>
              <input
                id="media-url-alt"
                type="text"
                value={alt}
                onChange={(e) => setAlt(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-ghost"
                disabled={!url.trim()}
                onClick={() => onPick(url.trim(), alt.trim())}
              >
                Use this address
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="media-tools">
              <input
                type="text"
                className="media-search"
                placeholder={`Search ${state.where ?? "the library"}`}
                value={search}
                onChange={(e) => {
                  setPage(1);
                  setSearch(e.target.value);
                }}
              />
              <input
                ref={file}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => {
                  const chosen = e.target.files?.[0];
                  e.target.value = "";
                  if (chosen) void send(chosen);
                }}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={busy}
                onClick={() => file.current?.click()}
              >
                {busy ? "Uploading…" : "Upload a picture"}
              </button>
            </div>

            <label className="field-label" htmlFor="media-alt">
              Describe the next one you add or choose
            </label>
            <input
              id="media-alt"
              type="text"
              className="media-alt"
              value={alt}
              placeholder="A roulette wheel mid-spin"
              onChange={(e) => setAlt(e.target.value)}
            />

            {!state.items?.length ? (
              <p className="empty">
                {search
                  ? `Nothing in the library matches ${search}.`
                  : "Nothing in the library yet. Upload the first one."}
              </p>
            ) : (
              <ul className="media-grid">
                {state.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="media-tile"
                      title={`${item.title || item.url}${item.width ? ` — ${item.width} by ${item.height}` : ""}`}
                      onClick={() => onPick(item.url, alt.trim() || item.alt)}
                    >
                      <img src={item.thumb} alt={item.alt} loading="lazy" />
                      <span className="media-tile-name">{item.title || "Untitled"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {(state.pages ?? 1) > 1 ? (
              <div className="media-pages">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={page <= 1}
                  onClick={() => setPage((n) => n - 1)}
                >
                  Newer
                </button>
                <span className="version-count">
                  {page} of {state.pages}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={page >= (state.pages ?? 1)}
                  onClick={() => setPage((n) => n + 1)}
                >
                  Older
                </button>
              </div>
            ) : null}

            <p className="provider-hint">
              Pictures are kept in {state.where ?? "this site"}&apos;s own
              WordPress library, so the site serves its own. The most that can be
              sent at once is{" "}
              {((state.limit ?? 4_400_000) / 1_000_000).toFixed(1)}MB, which is
              what a serverless request will carry.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
