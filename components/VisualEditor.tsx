"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MediaPicker from "@/components/MediaPicker";
import { liveScripts, renderPage, type ShellPage, type ShellSite } from "@/lib/siteshell";

/**
 * Editing the page inside the page.
 *
 * The first version of this put an editing surface in a bare box beneath the
 * preview: the words in one place, the site they belong to in another. A
 * heading's size is a decision about how it sits against the header above it
 * and the section beside it, and neither was visible while making it.
 *
 * So the preview is the editor. The panel names what is selected and offers
 * what it is made of; the page itself is where the pointing and the typing
 * happen.
 *
 * It is driven over messages rather than by reaching in, because the frame is
 * sandboxed without same-origin access and that is worth keeping: the page
 * carries markup a model wrote and may carry its own script, and neither
 * should be a keystroke away from the console's session. A small bridge runs
 * inside the frame, alone with the page, and this talks to it. The panel never
 * touches the document; the document never reaches the console.
 *
 * Only the body of the page is editable. The header and footer come from
 * settings and from the shell design, and typing into them here would put
 * changes somewhere nothing reads back — they have their own tab.
 */

/** What the chrome can be typed into, and what each of them changes. */
const SETTINGS = ["name", "tagline", "footerText", "linkLabel", "pageTitle"] as const;
export type Setting = (typeof SETTINGS)[number];

interface Chosen {
  label: string;
  path: string[];
  /** The page, or the header and footer, which are kept in different places. */
  where?: "page" | "chrome";
  /** The colour showing through, when the element sets none of its own. */
  backdrop: string;
  /** Whether the background is the element's own rather than what is behind it. */
  ownBackground: boolean;
  isImage: boolean;
  isLink: boolean;
  src: string;
  alt: string;
  href: string;
  styles: Record<string, string>;
}

const FONTS: Array<[string, string]> = [
  ["", "Inherit from the page"],
  ["system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", "System sans"],
  ["Georgia, 'Times New Roman', serif", "Serif"],
  ["'Iowan Old Style', Palatino, Georgia, serif", "Old style serif"],
  ["ui-monospace, SFMono-Regular, Menlo, monospace", "Monospace"],
  ["'Trebuchet MS', 'Segoe UI', sans-serif", "Humanist"],
];

interface Control {
  key: string;
  label: string;
  kind: "length" | "colour" | "select" | "text";
  options?: Array<[string, string]>;
  unit?: string;
}

const TYPE: Control[] = [
  { key: "fontSize", label: "Size", kind: "length", unit: "px" },
  {
    key: "fontWeight",
    label: "Weight",
    kind: "select",
    options: ["", "300", "400", "500", "600", "700", "800"].map((w) => [w, w || "Inherit"]),
  },
  { key: "fontFamily", label: "Typeface", kind: "select", options: FONTS },
  { key: "color", label: "Colour", kind: "colour" },
  { key: "lineHeight", label: "Line height", kind: "text" },
  { key: "letterSpacing", label: "Letter spacing", kind: "length", unit: "px" },
  {
    key: "textAlign",
    label: "Align",
    kind: "select",
    options: ["", "left", "center", "right"].map((a) => [a, a || "Inherit"]),
  },
];

const BOX: Control[] = [
  { key: "backgroundColor", label: "Background", kind: "colour" },
  { key: "width", label: "Width", kind: "length", unit: "px" },
  { key: "height", label: "Height", kind: "length", unit: "px" },
  { key: "maxWidth", label: "Max width", kind: "length", unit: "px" },
  { key: "padding", label: "Padding", kind: "length", unit: "px" },
  { key: "margin", label: "Margin", kind: "length", unit: "px" },
  { key: "borderRadius", label: "Corner radius", kind: "length", unit: "px" },
  { key: "border", label: "Border", kind: "text" },
];

/** "18" becomes "18px"; "2rem" and "auto" are left alone. */
function withUnit(value: string, unit?: string): string {
  const raw = value.trim();
  if (!raw || !unit) return raw;
  return /^-?[\d.]+$/.test(raw) ? `${raw}${unit}` : raw;
}

/** A colour input needs #rrggbb; computed styles arrive as rgb(). */
function toHex(value: string): string {
  const m = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000";
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
}

export default function VisualEditor({
  site,
  pages,
  current,
  editable,
  onChange,
  onTitle,
  onSetting,
  onChromeStyle,
  onNavigate,
  onSave,
  onPublish,
  websiteId,
  dirty,
  saving,
}: {
  site: Omit<ShellSite, "pages">;
  pages: ShellPage[];
  /** The slug being edited. */
  current: string;
  editable: boolean;
  onChange: (html: string) => void;
  /** The heading is the title field, so typing in it lands here. */
  onTitle: (title: string) => void;
  /**
   * So is everything else the header and footer are written from.
   *
   * `at` says which one, for the settings there is more than one of: which
   * link, or which page's title.
   */
  onSetting: (field: Setting, value: string, at?: string) => void;
  /**
   * A colour or a typeface changed on the header or footer.
   *
   * Handed over as a selector rather than as markup, because the chrome is
   * rendered from a template every time and an inline style on it would last
   * until the next render.
   */
  onChromeStyle: (selector: string, property: string, value: string) => void;
  onNavigate: (slug: string) => void;
  /**
   * Saving and publishing, for when this is the whole window.
   *
   * Full screen hides the page these two normally live on, and the moment
   * somebody is most likely to want them is after an hour of editing in it.
   */
  onSave: () => void;
  onPublish: () => void;
  /** Which website this is, so its own picture library can be opened. */
  websiteId: string;
  dirty: boolean;
  saving: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [tab, setTab] = useState<"type" | "box">("type");
  const [full, setFull] = useState(false);
  const [size, setSize] = useState(0);
  /** Snapshots for undo, newest last. A rescue, not a history. */
  const [past, setPast] = useState<string[]>([]);
  /** Whether the picture library is open, and where what it returns should go. */
  const [picking, setPicking] = useState(false);

  const page = useMemo(
    () => pages.find((p) => p.slug === current) ?? pages[0],
    [pages, current],
  );

  /**
   * What has to change before the frame is worth loading again.
   *
   * Reloading is the expensive thing here, and not in cycles: it throws away
   * the caret, the selection and the scroll position, so doing it on every
   * keystroke would make the page impossible to type into. Content is
   * deliberately absent from this. Edits travel outward the moment they happen
   * and the frame already shows them, so re-rendering would only redraw what
   * is on screen and lose the cursor doing it.
   *
   * Titles are absent for the same reason, even though the navigation is built
   * from them: typing into the heading would reload the page it is being typed
   * into. So a renamed page keeps its old label in the navigation until
   * something else brings the frame back, which is a small staleness in
   * exchange for a heading that can be edited at all.
   *
   * A string rather than a list of dependencies, because the site arrives as a
   * fresh object every render and comparing it by identity would reload
   * constantly.
   */
  /*
   * Everything in the header and footer except the words that can be typed into
   * them.
   *
   * A setting changed on the other tab — whether the navigation shows, what a
   * link points at, whether there is a copyright line — changes the shape of the
   * page and the frame has to be built again to show it. A word typed into the
   * page must not, because rebuilding it takes the cursor along.
   *
   * So the difference is drawn here rather than by leaving the header and
   * footer out altogether, which would have left the arrangement stale.
   */
  const chrome = JSON.stringify([
    { ...site.header, links: site.header.links.map((l) => l.url) },
    { ...site.footer, text: "", links: site.footer.links.map((l) => l.url) },
  ]);

  const signature = JSON.stringify([
    current,
    editable,
    // The name and the tagline are absent for the same reason titles are: they
    // can be typed into the page, and rebuilding the frame under somebody
    // mid-word would take the cursor with it.
    site.language,
    // The stylesheet is absent: styling the header writes into it, and
    // rebuilding the frame on every change would take the selection with it.
    // The shell's markup is not, since changing that changes the arrangement.
    site.design?.headerHtml ?? "",
    site.design?.footerHtml ?? "",
    chrome,
    site.theme,
    pages.map((p) => p.slug),
  ]);

  const html = useMemo(() => {
    if (!page) return "";
    return renderPage({ ...site, pages }, page, {
      current,
      editing: editable,
      interactive: !editable,
      year: new Date().getFullYear(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  const send = useCallback((message: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage({ preview: "edit", ...message }, "*");
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data) return;

      if (data.preview === "selected") {
        setChosen((data.element as Chosen | null) ?? null);
        return;
      }

      if (data.preview === "title") {
        onTitle(String(data.text ?? "").trim());
        return;
      }

      if (data.preview === "site") {
        const field = String(data.field ?? "");
        if (!SETTINGS.includes(field as Setting)) return;
        const value = String(data.text ?? "");
        onSetting(
          field as Setting,
          // The footer's words may have lines in them and are theirs to keep;
          // everything else here is one string and is trimmed.
          field === "footerText" ? value : value.trim(),
          data.at === undefined || data.at === null ? undefined : String(data.at),
        );
        return;
      }

      // Pressed inside the frame, where the console cannot hear it.
      if (data.preview === "escape") {
        setFull(false);
        return;
      }

      if (data.preview === "chrome") {
        onChromeStyle(
          String(data.selector ?? ""),
          String(data.key ?? ""),
          String(data.value ?? ""),
        );
        return;
      }

      if (data.preview === "html") {
        // The page's own scripts went in with a type nothing executes, so what
        // comes back is the markup as written rather than as it ran. Undo that
        // before it is saved.
        const next = liveScripts(String(data.html ?? ""));
        if (next !== page?.bodyHtml) {
          setPast((rows) => [...rows, page?.bodyHtml ?? ""].slice(-40));
          onChange(next);
        }
        return;
      }

      // A link click while not editing, which is the plain preview's job.
      if (data.preview === "go") {
        const href = String(data.href ?? "").trim();
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
          if (/^https?:/i.test(href)) window.open(href, "_blank", "noopener,noreferrer");
          return;
        }
        const slug = href
          .replace(/[?#].*$/, "")
          .replace(/^[./]+/, "")
          .replace(/\.html?$/i, "")
          .replace(/\/$/, "");
        const wanted = slug === "index" ? "" : slug;
        if (pages.some((p) => p.slug === wanted)) onNavigate(wanted);
      }
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onChange, onChromeStyle, onNavigate, onSetting, onTitle, page?.bodyHtml, pages]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [full]);

  const undo = useCallback(() => {
    setPast((rows) => {
      if (!rows.length) return rows;
      const previous = rows[rows.length - 1]!;
      send({ do: "replace", html: previous });
      onChange(previous);
      return rows.slice(0, -1);
    });
  }, [onChange, send]);

  if (!page) return <div className="empty">Nothing to edit yet.</div>;

  const controls = tab === "type" ? TYPE : BOX;

  return (
    <div className={full ? "ve preview-shell is-full" : "ve preview-shell"}>
      <div className="ve-bar">
        {editable ? (
          <>
            <div className="seg seg-sm">
              {(["bold", "italic", "underline"] as const).map((command, i) => (
                <button
                  key={command}
                  type="button"
                  className="seg-btn"
                  title={command[0]!.toUpperCase() + command.slice(1)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => send({ do: "exec", command })}
                >
                  {["B", "I", "U"][i]}
                </button>
              ))}
            </div>

            <div className="seg seg-sm">
              {(["p", "h2", "h3", "h4"] as const).map((block) => (
                <button
                  key={block}
                  type="button"
                  className="seg-btn"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => send({ do: "exec", command: "formatBlock", argument: block })}
                >
                  {block === "p" ? "Text" : block.toUpperCase()}
                </button>
              ))}
            </div>

            <div className="seg seg-sm">
              <button
                type="button"
                className="seg-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const url = window.prompt("Link to where?");
                  if (url) send({ do: "exec", command: "createLink", argument: url });
                }}
              >
                Link
              </button>
              <button
                type="button"
                className="seg-btn"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setPicking(true)}
              >
                Image
              </button>
            </div>

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={undo}
              disabled={!past.length}
            >
              Undo
            </button>
          </>
        ) : null}

        <div className="seg seg-sm ve-widths">
          {([["Fit", 0], ["Phone", 390], ["Tablet", 820], ["Laptop", 1280]] as const).map(
            ([label, width]) => (
              <button
                key={label}
                type="button"
                className={size === width ? "seg-btn is-on" : "seg-btn"}
                onClick={() => setSize(width)}
              >
                {label}
              </button>
            ),
          )}
        </div>

        {full && editable ? (
          <>
            <button
              type="button"
              className="btn btn-primary btn-sm ve-save"
              onClick={onSave}
              disabled={!dirty || saving}
            >
              {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                // Publishing is a tab on the page behind this, so the way to it
                // is out of here first.
                setFull(false);
                onPublish();
              }}
            >
              Publish
            </button>
          </>
        ) : null}

        <button
          type="button"
          className="preview-expand is-inline"
          onClick={() => setFull((v) => !v)}
          title={full ? "Leave full screen (Escape)" : "Fill the window"}
          aria-label={full ? "Leave full screen" : "Fill the window"}
        >
          {full ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
            </svg>
          )}
        </button>
      </div>

      {picking ? (
        <MediaPicker
          websiteId={websiteId}
          onClose={() => setPicking(false)}
          onPublish={() => {
            setPicking(false);
            setFull(false);
            onPublish();
          }}
          onPick={(src, alt) => {
            setPicking(false);
            send({
              do: "exec",
              command: "insertHTML",
              argument:
                `<img src="${src.replace(/"/g, "&quot;")}" ` +
                `alt="${alt.replace(/"/g, "&quot;")}">`,
            });
          }}
        />
      ) : null}

      <div className="ve-body">
        <div className={size ? "preview-stage is-sized" : "preview-stage"}>
          <iframe
            ref={frame}
            className="site-preview"
            title={editable ? "Editing the page" : "Website preview"}
            style={size ? { width: `${size}px`, flex: "0 0 auto" } : undefined}
            // Scripts, so the bridge and the navigation work. No same-origin,
            // so the frame is its own origin and can reach nothing here.
            sandbox="allow-scripts"
            srcDoc={html}
          />
        </div>

        {editable ? (
          <aside className="ve-panel">
            {!chosen ? (
              <p className="provider-hint">
                Click anything in the page to change how it looks. Typing works
                wherever the cursor is. The header and footer have their own
                tab.
              </p>
            ) : (
              <>
                {chosen.where === "chrome" ? (
                  <p className="ve-scope">
                    In the header or footer. Changes here are kept as part of
                    the site&apos;s own look, so they apply on every page.
                  </p>
                ) : (
                  <p className="ve-scope ve-quiet">
                    Drag the blue handles on the box to size it, or move it
                    among the things beside it below.
                  </p>
                )}

                <div className="ve-crumbs">
                  {chosen.path.map((name, i) => (
                    <button
                      key={`${name}-${i}`}
                      type="button"
                      className={i === chosen.path.length - 1 ? "ve-crumb is-on" : "ve-crumb"}
                      title="Select what contains it"
                      onClick={() => {
                        for (let up = chosen.path.length - 1 - i; up > 0; up -= 1) {
                          send({ do: "up" });
                        }
                      }}
                    >
                      {name}
                    </button>
                  ))}
                </div>

                <div className="seg seg-sm ve-tabs">
                  <button
                    type="button"
                    className={tab === "type" ? "seg-btn is-on" : "seg-btn"}
                    onClick={() => setTab("type")}
                  >
                    Type
                  </button>
                  <button
                    type="button"
                    className={tab === "box" ? "seg-btn is-on" : "seg-btn"}
                    onClick={() => setTab("box")}
                  >
                    Box
                  </button>
                </div>

                {chosen.isImage ? (
                  <>
                    <div className="ve-field">
                      <label className="field-label">Image address</label>
                      <input
                        type="text"
                        defaultValue={chosen.src}
                        key={`src-${chosen.src}`}
                        onBlur={(e) => send({ do: "attr", name: "src", value: e.target.value })}
                      />
                    </div>
                    <div className="ve-field">
                      <label className="field-label">Description</label>
                      <input
                        type="text"
                        defaultValue={chosen.alt}
                        key={`alt-${chosen.alt}`}
                        onBlur={(e) => send({ do: "attr", name: "alt", value: e.target.value })}
                      />
                    </div>
                  </>
                ) : null}

                {chosen.isLink ? (
                  <div className="ve-field">
                    <label className="field-label">Links to</label>
                    <input
                      type="text"
                      defaultValue={chosen.href}
                      key={`href-${chosen.href}`}
                      onBlur={(e) => send({ do: "attr", name: "href", value: e.target.value })}
                    />
                  </div>
                ) : null}

                {controls.map((control) => {
                  const value = chosen.styles[control.key] ?? "";
                  return (
                    <div className="ve-field" key={control.key}>
                      <label className="field-label">{control.label}</label>
                      {control.kind === "select" ? (
                        <select
                          value={value}
                          onChange={(e) =>
                            send({ do: "style", key: control.key, value: e.target.value })
                          }
                        >
                          {(control.options ?? []).map(([v, label]) => (
                            <option key={v} value={v}>
                              {label}
                            </option>
                          ))}
                        </select>
                      ) : control.kind === "colour" ? (
                        <>
                          <div className="ve-colour">
                            <input
                              type="color"
                              className="colour-input"
                              /*
                               * A background nothing has set computes to a
                               * transparent black, and a swatch can only draw
                               * that as black — which reads as a colour that is
                               * set and wrong. So the colour showing through is
                               * drawn instead, and said to be that.
                               */
                              value={toHex(
                                control.key === "backgroundColor" && !chosen.ownBackground
                                  ? chosen.backdrop
                                  : value,
                              )}
                              onChange={(e) =>
                                send({ do: "style", key: control.key, value: e.target.value })
                              }
                            />
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => send({ do: "style", key: control.key, value: "" })}
                              title="Back to whatever the page says"
                            >
                              Clear
                            </button>
                          </div>
                          {control.key === "backgroundColor" && !chosen.ownBackground ? (
                            <p className="ve-note">
                              None of its own. This is what shows through from
                              behind it.
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <input
                          type="text"
                          defaultValue={value}
                          key={`${chosen.label}-${control.key}-${value}`}
                          placeholder="inherit"
                          onBlur={(e) =>
                            send({
                              do: "style",
                              key: control.key,
                              value: withUnit(e.target.value, control.unit),
                            })
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                          }}
                        />
                      )}
                    </div>
                  );
                })}

                {chosen.where !== "chrome" ? (
                  <div className="ve-actions ve-order">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      title="Move it above the one before it"
                      onClick={() => send({ do: "move", by: -1 })}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      title="Move it below the one after it"
                      onClick={() => send({ do: "move", by: 1 })}
                    >
                      Move down
                    </button>
                  </div>
                ) : null}

                <div className="ve-actions">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => send({ do: "duplicate" })}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => send({ do: "delete" })}
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
