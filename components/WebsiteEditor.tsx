"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import VisualEditor from "@/components/VisualEditor";
import { hasBehaviour } from "@/lib/pagehtml";
import SitePreview from "@/components/SitePreview";
import SitePublish from "@/components/SitePublish";
import SiteVersions from "@/components/SiteVersions";
import { Select } from "@/components/Select";
import type {
  SiteDesign as Design,
  SiteFooter as Footer,
  SiteHeader as Header,
  SiteLink,
  SiteTheme as Theme,
  Website,
  WebsitePage as Page,
} from "@/lib/websites";

/** What Google will show, near enough, so the limits mean something. */
const TITLE_LIMIT = 60;
const DESC_LIMIT = 155;

/**
 * Editing a website that has not been hosted yet.
 *
 * Pages down the left, the page being worked on in the middle, the whole site
 * rendered on the right and keeping up as you type.
 *
 * The preview used to be a third tab beside Edit and HTML, which meant seeing
 * the result and changing it were two things you switched between — so nobody
 * looked at the result until they had stopped editing. It is a pane now, and
 * the editor reports changes a beat after each keystroke rather than waiting
 * for you to click away.
 *
 * Edit renders the page body alone and lets you type into it, because editing
 * wants the writing and not the furniture around it. HTML is the same page as
 * markup, still there because a rendered page cannot show you a stray tag.
 *
 * The markup is read back only when you click away from the page, not on every
 * keystroke. Browsers normalise contenteditable markup as they go, so writing
 * it back mid-word would shift the text under the cursor.
 *
 * Nothing saves by itself. A site being edited is a draft of a draft, and an
 * autosave that fired mid-sentence would make the undo history useless.
 */
/**
 * A list of label-and-address pairs.
 *
 * The same control for the header and the footer, because they are the same
 * thing in two places and two near-identical blocks would drift.
 */
function LinkList({
  label,
  hint,
  links,
  onChange,
}: {
  label: string;
  hint: string;
  links: SiteLink[];
  onChange: (links: SiteLink[]) => void;
}) {
  return (
    <>
      <label className="field-label">{label}</label>
      <p className="provider-hint">{hint}</p>
      {links.map((link, i) => (
        <div className="link-row" key={i}>
          <input
            type="text"
            value={link.label}
            placeholder="Label"
            onChange={(e) =>
              onChange(links.map((l, at) => (at === i ? { ...l, label: e.target.value } : l)))
            }
          />
          <input
            type="text"
            value={link.url}
            placeholder="https://..."
            onChange={(e) =>
              onChange(links.map((l, at) => (at === i ? { ...l, url: e.target.value } : l)))
            }
          />
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => onChange(links.filter((_, at) => at !== i))}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => onChange([...links, { label: "", url: "" }])}
        disabled={links.length >= 12}
      >
        Add a link
      </button>
    </>
  );
}

export default function WebsiteEditor({ id }: { id: string }) {
  const [site, setSite] = useState<Website | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [header, setHeader] = useState<Header | null>(null);
  const [footer, setFooter] = useState<Footer | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);
  /** Which page, or the site furniture that surrounds all of them. */
  const [section, setSection] = useState<"pages" | "design" | "versions" | "publish">("pages");

  /*
   * The tab the address asks for.
   *
   * WordPress sends somebody back here after they authorise the console on
   * their own site, and they should land on the tab they left from rather than
   * at the top of a page they then have to find their way through again.
   */
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab");
    if (wanted === "publish" || wanted === "versions" || wanted === "design") {
      setSection(wanted);
    }
  }, []);
  /**
   * Bumped whenever the site is written to, so the version list reloads.
   *
   * A counter rather than a callback into the list: the list owns its own
   * loading, and the only thing the editor knows is that something changed.
   */
  const [saves, setSaves] = useState(0);
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
  /**
   * Whether the page is shown at all.
   *
   * On by default, and a pane rather than a mode. It was a third tab, which
   * meant seeing the result and changing it were two things you switched
   * between — so nobody looked at the result until they had stopped editing.
   * Now it is also where the editing happens, so turning it off falls back to
   * the HTML rather than leaving nothing to work with.
   */
  const [showPreview, setShowPreview] = useState(true);

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
      setHeader(found.header);
      setFooter(found.footer);
      setTheme(found.theme);
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
        body: JSON.stringify({ name, tagline, pages, header, footer, theme }),
      });
      if (response.status === 401) {
        window.location.href = "/login";
        return;
      }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? `The save returned ${response.status}.`);

      const back = payload.website as Website;
      setSite(back);
      setPages(back.pages);
      setHeader(back.header);
      setFooter(back.footer);
      setTheme(back.theme);
      setDirty(false);
      setSaved(true);
      setSaves((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The website could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  function touch() {
    setDirty(true);
    setSaved(false);
  }

  /**
   * Whether the page can be typed into, rather than only looked at.
   *
   * Not while it is still being written: the build replaces pages as it
   * finishes them, and an edit made against a page about to be overwritten is
   * an edit thrown away without saying so.
   */
  const editing = view === "visual" && site?.status !== "building";

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
            <Link className="btn btn-ghost bar-btn" href="/websites">
              All websites
            </Link>
            {pages.length ? (
              <a
                className="btn btn-ghost bar-btn"
                href={`/api/websites/${id}/export`}
                title="Every page as an HTML file, in a zip you can open from a folder."
              >
                Download
              </a>
            ) : null}
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

          <div className="editor-sections">
            <div className="seg seg-sm">
              <button
                type="button"
                className={section === "pages" ? "seg-btn is-on" : "seg-btn"}
                onClick={() => setSection("pages")}
              >
                Pages
              </button>
              <button
                type="button"
                className={section === "design" ? "seg-btn is-on" : "seg-btn"}
                onClick={() => setSection("design")}
              >
                Header and footer
              </button>
              <button
                type="button"
                className={section === "versions" ? "seg-btn is-on" : "seg-btn"}
                onClick={() => setSection("versions")}
              >
                Versions
              </button>
              <button
                type="button"
                className={section === "publish" ? "seg-btn is-on" : "seg-btn"}
                onClick={() => setSection("publish")}
              >
                Publish
              </button>
            </div>
            {section === "pages" && !showPreview ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowPreview(true)}
              >
                Show preview
              </button>
            ) : null}
          </div>

          {section === "publish" ? (
            <div className="editor-sections editor-versions">
              {dirty ? (
                <p className="notice warn">
                  There are unsaved changes. Publishing sends what was saved, so
                  save first or the site will go out a version behind.
                </p>
              ) : null}
              <SitePublish
                site={site}
                onPublished={(back) => {
                  // Only the record of where it went changed; everything being
                  // edited is untouched, so nothing on screen is replaced.
                  setSite(back);
                }}
              />
            </div>
          ) : null}

          {section === "versions" ? (
            <div className="editor-sections editor-versions">
              {dirty ? (
                <p className="notice warn">
                  There are unsaved changes. They are not a version yet, and
                  restoring an earlier one would discard them.
                </p>
              ) : null}
              <SiteVersions
                site={site}
                token={saves}
                onRestored={(back) => {
                  /*
                   * A restore replaces everything the editor is holding, so all
                   * of it is taken from what came back rather than merged. An
                   * editor still showing the old header over a restored site
                   * would write that header straight back on the next save.
                   */
                  setSite(back);
                  setName(back.name);
                  setTagline(back.tagline);
                  setPages(back.pages);
                  setHeader(back.header);
                  setFooter(back.footer);
                  setTheme(back.theme);
                  setAt(0);
                  setDirty(false);
                  setSaved(false);
                  setSaves((n) => n + 1);
                }}
              />
            </div>
          ) : null}

          {section === "design" && header && footer && theme ? (
            <div className="editor-split">
              <div className="editor-panel">
                <h3>Header</h3>
                <p className="stage-hint">
                  What sits above every page. A WordPress theme supplies its
                  own, so these shape the preview and the download rather than
                  the live site; for a static site they are the real thing.
                </p>

                <label className="field-label" htmlFor="logo-url">
                  Logo image address
                </label>
                <input
                  id="logo-url"
                  type="text"
                  value={header.logoUrl}
                  placeholder="https://example.com/logo.png, or leave blank to use the name"
                  onChange={(e) => {
                    setHeader({ ...header, logoUrl: e.target.value });
                    touch();
                  }}
                />

                <div className="check-row">
                  {(
                    [
                      ["showName", "Show the site name"],
                      ["showTagline", "Show the tagline"],
                      ["showNav", "Show navigation"],
                    ] as Array<["showName" | "showTagline" | "showNav", string]>
                  ).map(([key, label]) => (
                    <label className="check" key={key}>
                      <input
                        type="checkbox"
                        checked={header[key]}
                        onChange={(e) => {
                          setHeader({ ...header, [key]: e.target.checked });
                          touch();
                        }}
                      />
                      {label}
                    </label>
                  ))}
                </div>

                <LinkList
                  label="Extra links in the header"
                  hint="Beyond the pages themselves: a shop, a booking form, somewhere else entirely."
                  links={header.links}
                  onChange={(links) => {
                    setHeader({ ...header, links });
                    touch();
                  }}
                />

                <h3 className="editor-subhead">Footer</h3>

                <label className="field-label" htmlFor="footer-text">
                  Footer text
                </label>
                <textarea
                  id="footer-text"
                  rows={3}
                  value={footer.text}
                  placeholder="An address, opening hours, a line about who you are."
                  onChange={(e) => {
                    setFooter({ ...footer, text: e.target.value });
                    touch();
                  }}
                />

                <div className="check-row">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={footer.showCopyright}
                      onChange={(e) => {
                        setFooter({ ...footer, showCopyright: e.target.checked });
                        touch();
                      }}
                    />
                    Show a copyright line
                  </label>
                </div>

                <LinkList
                  label="Footer links"
                  hint="Privacy, terms, anything that belongs at the bottom."
                  links={footer.links}
                  onChange={(links) => {
                    setFooter({ ...footer, links });
                    touch();
                  }}
                />

                <h3 className="editor-subhead">Look</h3>
                <p className="stage-hint">
                  Deliberately few settings. This shows writing rather than
                  design, and a strong theme flatters copy and hides what you
                  are trying to judge.
                </p>

                <div className="site-row">
                  {(
                    [
                      ["accent", "Accent"],
                      ["background", "Background"],
                      ["ink", "Text"],
                    ] as Array<["accent" | "background" | "ink", string]>
                  ).map(([key, label]) => (
                    <div key={key}>
                      <label className="field-label" htmlFor={`theme-${key}`}>
                        {label}
                      </label>
                      <input
                        id={`theme-${key}`}
                        type="color"
                        className="colour-input"
                        value={theme[key]}
                        onChange={(e) => {
                          setTheme({ ...theme, [key]: e.target.value });
                          touch();
                        }}
                      />
                    </div>
                  ))}
                  <div>
                    <label className="field-label" htmlFor="theme-font">
                      Typeface
                    </label>
                    <Select
                      id="theme-font"
                      value={theme.font}
                      onChange={(v) => {
                        setTheme({ ...theme, font: v === "serif" ? "serif" : "sans" });
                        touch();
                      }}
                      options={[
                        { value: "sans", label: "Sans serif" },
                        { value: "serif", label: "Serif" },
                      ]}
                    />
                  </div>
                  <div>
                    <label className="field-label" htmlFor="theme-width">
                      Text width
                    </label>
                    <Select
                      id="theme-width"
                      value={String(theme.width)}
                      onChange={(v) => {
                        setTheme({ ...theme, width: Number(v) });
                        touch();
                      }}
                      options={[
                        { value: "640", label: "Narrow", hint: "640px" },
                        { value: "760", label: "Comfortable", hint: "760px" },
                        { value: "920", label: "Wide", hint: "920px" },
                        { value: "1100", label: "Very wide", hint: "1100px" },
                      ]}
                    />
                  </div>
                </div>

                {pages.length ? (
                  <>
                    <div className="editor-body-head">
                      <span className="field-label">How it looks</span>
                    </div>
                    <SitePreview
                      site={{
                        name,
                        tagline,
                        language: site.language ?? "en",
                        design: site.design,
                        header,
                        footer,
                        theme,
                      }}
                      pages={pages}
                      current={pages[at]?.slug ?? ""}
                      onNavigate={(slug) => {
                        const to = pages.findIndex((p) => p.slug === slug);
                        if (to >= 0) setAt(to);
                      }}
                    />
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          {section === "pages" && pages.length ? (
            <div className={showPreview ? "editor-split has-preview" : "editor-split"}>
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

                  {/*
                    * The HTML, for when the page is easier to say than to point
                    * at. Editing by hand happens up in the page itself; this is
                    * the same content with the tags showing.
                    *
                    * Shown when asked for, and whenever the page above is not
                    * there to type into, so there is always a way in.
                    */}
                  {view === "code" || !showPreview ? (
                    <>
                      <div className="editor-body-head">
                        <label className="field-label" htmlFor="page-body">
                          Page content
                        </label>
                        {showPreview ? null : (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setShowPreview(true)}
                          >
                            Edit in the page
                          </button>
                        )}
                      </div>
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
                  ) : null}
                </div>
              ) : null}

              {/*
                * The page, and the place you edit it.
                *
                * These used to be two things: a preview across the top and an
                * editing box underneath. Which meant deciding a heading's size
                * in a bare box, with the header it sits under and the section
                * it sits beside both somewhere else on the screen. So the
                * preview is where the editing happens, and there is one page
                * rather than two versions of one.
                */}
              {showPreview && page ? (
                <aside className="editor-preview">
                  <div className="editor-body-head">
                    <span className="field-label">
                      {editing ? "Editing the page" : "Live preview"}
                    </span>
                    <div className="seg seg-sm">
                      <button
                        type="button"
                        className={view === "visual" ? "seg-btn is-on" : "seg-btn"}
                        onClick={() => setView("visual")}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className={view === "code" ? "seg-btn is-on" : "seg-btn"}
                        onClick={() => setView("code")}
                      >
                        HTML
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => setShowPreview(false)}
                    >
                      Hide
                    </button>
                  </div>
                  <VisualEditor
                    key={`${site.id}-${at}-${editing ? "edit" : "read"}`}
                    site={{
                      name,
                      tagline,
                      language: site.language ?? "en",
                      design: site.design,
                      header: header ?? site.header,
                      footer: footer ?? site.footer,
                      theme: theme ?? site.theme,
                    }}
                    pages={pages}
                    current={page.slug}
                    editable={editing}
                    onChange={(bodyHtml) => change({ bodyHtml })}
                    onTitle={(title) => change({ title })}
                    onSetting={(field, value, at) => {
                      /*
                       * The header and footer are drawn from settings, so what
                       * is typed into them belongs to the settings rather than
                       * to the page it was typed on.
                       *
                       * A link's label and a page's title say which one they
                       * are: "footer:2" for the third link in the footer, or a
                       * page's own address. The rest are one of a kind.
                       */
                      if (field === "name") setName(value);
                      else if (field === "tagline") setTagline(value);
                      else if (field === "footerText") {
                        setFooter((f) => (f ? { ...f, text: value } : f));
                      } else if (field === "linkLabel") {
                        const [which, index] = String(at ?? "").split(":");
                        const i = Number(index);
                        const relabel = (links: SiteLink[]) =>
                          links.map((l, n) => (n === i ? { ...l, label: value } : l));
                        if (which === "footer") {
                          setFooter((f) => (f ? { ...f, links: relabel(f.links) } : f));
                        } else {
                          setHeader((h) => (h ? { ...h, links: relabel(h.links) } : h));
                        }
                      } else if (field === "pageTitle") {
                        // The menu shows every page, so this may be the title
                        // of one that is not on screen.
                        setPages((rows) =>
                          rows.map((p) => (p.slug === at ? { ...p, title: value } : p)),
                        );
                      }
                      touch();
                    }}
                    onNavigate={(slug) => {
                      const to = pages.findIndex((p) => p.slug === slug);
                      if (to >= 0) setAt(to);
                    }}
                  />
                  <p className="provider-hint">
                    {site.status === "building"
                      ? "Read only while the site is still being written: a page that is rewritten under you would lose the edit."
                      : editing
                        ? "Click anything in the page to select it, then change its type, colour, spacing or size on the right. Typing works wherever the cursor is, including the words in the header and footer: the site's name and tagline, what the footer says, the label on any link and the title of any page in a menu. Where a link points, and what shows at all, are on the Header and footer tab. Save changes writes it down."
                        : "The whole site, header and footer included. The navigation works, and anything the page does for itself runs here. This is the document the download writes to a file."}
                  </p>
                  {editing && hasBehaviour(page.bodyHtml) ? (
                    <p className="provider-hint">
                      This page carries a script or its own styles. They run
                      here as they will once it is hosted, in a frame that can
                      reach nothing of the console. Your edits keep them.
                    </p>
                  ) : null}
                </aside>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
