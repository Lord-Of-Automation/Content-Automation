"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import PageCanvas from "@/components/PageCanvas";

type Page = {
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  bodyHtml: string;
  keywords: string[];
  order: number;
};

type Website = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  topic: string;
  format: "wordpress" | "static";
  status: "building" | "ready" | "failed";
  runId: string;
  note: string;
  pages: Page[];
};

/** What Google will show, near enough, so the limits mean something. */
const TITLE_LIMIT = 60;
const DESC_LIMIT = 155;

/**
 * Editing a website that has not been hosted yet.
 *
 * Pages down the left, the one being edited beside them, and two ways to work
 * on it. Visual renders the page and lets you type into it, which is what
 * anyone opening this actually wants and what the first version of it could not
 * do at all. HTML is the same page as markup, still there because a rendered
 * page cannot show you a stray tag and someone occasionally needs to fix one.
 *
 * The markup is read back only when you click away from the page, not on every
 * keystroke. Browsers normalise contenteditable markup as they go, so writing
 * it back mid-word would shift the text under the cursor.
 *
 * Nothing saves by itself. A site being edited is a draft of a draft, and an
 * autosave that fired mid-sentence would make the undo history useless.
 */
export default function WebsiteEditor({ id }: { id: string }) {
  const [site, setSite] = useState<Website | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [at, setAt] = useState(0);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  /**
   * Which way the page is being worked on.
   *
   * Visual is the default because it is the one that answers "what does this
   * look like", and until now nothing in the console did. Code is still here,
   * and still the only way to reach markup a rendered page cannot show you.
   */
  const [view, setView] = useState<"visual" | "code">("visual");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/websites/${id}`, { cache: "no-store" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The website API returned ${response.status}.`);

      const found = payload.website as Website;
      setSite(found);
      setPages(found.pages);
      setName(found.name);
      setTagline(found.tagline);
      setDirty(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The website could not be read.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // While a build is still writing, keep asking. Stops the moment it is not.
  useEffect(() => {
    if (site?.status !== "building" || dirty) return;
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [site?.status, dirty, load]);

  // Leaving with unsaved edits is nearly always a mistake, and the browser's
  // own prompt is the only one that fires on a closed tab.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const page = pages[at];

  function change(patch: Partial<Page>) {
    setPages((rows) => rows.map((p, i) => (i === at ? { ...p, ...patch } : p)));
    setDirty(true);
    setSaved(false);
  }

  async function stop() {
    setStopping(true);
    setError(null);
    try {
      const response = await fetch(`/api/websites/${id}/stop`, { method: "POST" });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The stop returned ${response.status}.`);
      setSite(payload.website as Website);
      setPages((payload.website as Website).pages);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The build could not be stopped.");
    } finally {
      setStopping(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/websites/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, tagline, pages }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The save returned ${response.status}.`);

      setSite(payload.website as Website);
      setPages((payload.website as Website).pages);
      setDirty(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The website could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const counts = useMemo(
    () => ({
      title: page?.metaTitle.length ?? 0,
      description: page?.metaDescription.length ?? 0,
    }),
    [page],
  );

  if (loading) return <div className="empty">Reading the website…</div>;
  if (!site) {
    return (
      <div className="card">
        <div className="card-body tight">
          <div className="notice bad">{error ?? "No such website."}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <div>
            <h2>{site.name}</h2>
            <p className="quiet">
              {site.format === "wordpress" ? "WordPress" : "Static HTML"} ·{" "}
              {pages.length} page{pages.length === 1 ? "" : "s"}
              {site.status === "building" ? " · still being written" : ""}
            </p>
          </div>
          <div className="app-head-actions">
            <Link className="btn btn-ghost btn-sm" href="/websites">
              All websites
            </Link>
            {site.status === "building" ? (
              <button
                type="button"
                className="btn btn-ghost bar-btn"
                onClick={() => void stop()}
                disabled={stopping}
                title="Stop writing. The pages already written are kept."
              >
                {stopping ? "Stopping…" : "Stop writing"}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-primary bar-btn"
              onClick={() => void save()}
              disabled={!dirty || saving}
            >
              {saving ? "Saving…" : dirty ? "Save changes" : saved ? "Saved" : "Saved"}
            </button>
          </div>
        </div>

        <div className="card-body tight">
          {error ? <div className="notice bad">{error}</div> : null}

          {site.status === "building" ? (
            <div className="notice warn">
              <strong>This site is still being written.</strong> The pages below
              are the ones finished so far, and more will appear. Editing now is
              fine, but a page that arrives later will not carry your changes to
              a page of the same name.
            </div>
          ) : null}

          {site.status === "failed" && !pages.length ? (
            <div className="notice bad">
              <strong>Nothing was written.</strong> {site.note}{" "}
              {site.runId ? (
                <Link href={`/runs?run=${site.runId}`}>Open the run log</Link>
              ) : null}
            </div>
          ) : null}

          <section className="sheet-section">
            <h3>The site</h3>
            <div className="site-row">
              <div>
                <label className="field-label" htmlFor="site-name-edit">
                  Name
                </label>
                <input
                  id="site-name-edit"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setDirty(true);
                    setSaved(false);
                  }}
                />
              </div>
              <div className="site-row-wide">
                <label className="field-label" htmlFor="site-tagline-edit">
                  Tagline
                </label>
                <input
                  id="site-tagline-edit"
                  type="text"
                  value={tagline}
                  onChange={(e) => {
                    setTagline(e.target.value);
                    setDirty(true);
                    setSaved(false);
                  }}
                />
              </div>
            </div>
          </section>

          {pages.length ? (
            <div className="editor-split">
              <nav className="editor-pages" aria-label="Pages">
                {pages.map((p, i) => (
                  <button
                    key={`${p.slug}-${i}`}
                    type="button"
                    className={i === at ? "editor-page is-on" : "editor-page"}
                    onClick={() => setAt(i)}
                  >
                    <span className="editor-page-title">{p.title}</span>
                    <span className="editor-page-slug">
                      {p.slug ? `/${p.slug}` : "front page"}
                    </span>
                  </button>
                ))}
              </nav>

              {page ? (
                <div className="editor-panel">
                  <label className="field-label" htmlFor="page-title">
                    Title
                  </label>
                  <input
                    id="page-title"
                    type="text"
                    value={page.title}
                    onChange={(e) => change({ title: e.target.value })}
                  />

                  {at > 0 ? (
                    <>
                      <label className="field-label" htmlFor="page-slug">
                        Address
                      </label>
                      <input
                        id="page-slug"
                        type="text"
                        value={page.slug}
                        onChange={(e) => change({ slug: e.target.value })}
                      />
                    </>
                  ) : (
                    <p className="provider-hint">
                      This is the front page, so it has no address of its own.
                    </p>
                  )}

                  <label className="field-label" htmlFor="page-meta-title">
                    Meta title{" "}
                    <span className={counts.title > TITLE_LIMIT ? "count-over" : "count-ok"}>
                      {counts.title}/{TITLE_LIMIT}
                    </span>
                  </label>
                  <input
                    id="page-meta-title"
                    type="text"
                    value={page.metaTitle}
                    onChange={(e) => change({ metaTitle: e.target.value })}
                  />

                  <label className="field-label" htmlFor="page-meta-description">
                    Meta description{" "}
                    <span className={counts.description > DESC_LIMIT ? "count-over" : "count-ok"}>
                      {counts.description}/{DESC_LIMIT}
                    </span>
                  </label>
                  <textarea
                    id="page-meta-description"
                    rows={2}
                    value={page.metaDescription}
                    onChange={(e) => change({ metaDescription: e.target.value })}
                  />
                  <p className="provider-hint">
                    Over the limit is allowed and not an error. Google truncates
                    rather than refusing, and a slightly long description that
                    reads well beats a short one that does not.
                  </p>

                  <div className="editor-body-head">
                    <label className="field-label" htmlFor="page-body">
                      Page content
                    </label>
                    <div className="seg seg-sm">
                      <button
                        type="button"
                        className={view === "visual" ? "seg-btn is-on" : "seg-btn"}
                        onClick={() => setView("visual")}
                      >
                        Visual
                      </button>
                      <button
                        type="button"
                        className={view === "code" ? "seg-btn is-on" : "seg-btn"}
                        onClick={() => setView("code")}
                      >
                        HTML
                      </button>
                    </div>
                  </div>

                  {view === "visual" ? (
                    <>
                      <PageCanvas
                        key={`${site.id}-${at}`}
                        html={page.bodyHtml}
                        editable={site.status !== "building"}
                        onChange={(bodyHtml) => change({ bodyHtml })}
                      />
                      <p className="provider-hint">
                        {site.status === "building"
                          ? "Read only while the site is still being written: a page that is rewritten under you would lose the edit."
                          : "Click into the page and type. Changes are kept when you click away, and saved when you press Save changes."}
                      </p>
                    </>
                  ) : (
                    <>
                      <textarea
                        id="page-body"
                        className="editor-body"
                        rows={22}
                        spellCheck
                        value={page.bodyHtml}
                        onChange={(e) => change({ bodyHtml: e.target.value })}
                      />
                      <p className="provider-hint">
                        HTML, because that is what was written and what
                        WordPress will take. Images go in as ordinary img tags
                        for now; the picture library comes with hosting.
                      </p>
                    </>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
