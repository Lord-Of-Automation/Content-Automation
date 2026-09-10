"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import MediaPicker from "@/components/MediaPicker";
import { BLOCK_GROUPS, BLOCKS } from "@/lib/blocks";
import { liveScripts, renderPage, type ShellPage, type ShellSite } from "@/lib/siteshell";
import { useAsk } from "@/components/Ask";

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

/** What is selected, for anything outside this that wants to know. */
export interface Selected {
  label: string;
  path: string[];
  where: "page" | "chrome";
  text: string;
  html: string;
}

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
  /** Only what is set for the width being edited, when that is not every width. */
  atWidth: Record<string, string>;
  text: string;
  html: string;
}

/**
 * A block taken off a page, with whatever it was wearing.
 *
 * The markup alone would arrive on the other page having silently lost every
 * style set for a narrower width, so the rules travel with it and are written
 * back under names minted for wherever it lands.
 */
export interface Clip {
  html: string;
  label: string;
  styles: Record<string, Record<string, Record<string, string>>> | null;
}

/** One top-level block of the page, as the outline lists them. */
interface Row {
  at: number;
  label: string;
  heading: string;
  text: string;
  here: boolean;
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

/**
 * The widths the page can be looked at, and the width a style set there means.
 *
 * The two are deliberately different numbers. The preview width is a screen to
 * imagine; the breakpoint is where the rule starts applying, and it has to be
 * wide enough to cover every screen of that kind rather than the one being
 * drawn. A style meant for phones that only applied at exactly 390 pixels would
 * miss almost every phone.
 *
 * Fit and Laptop have no breakpoint of their own. Fit is whatever the pane
 * happens to be, which is not a screen size, and Laptop is the width the page
 * is designed at, which is what "every width" already means.
 */
const WIDTHS: Array<{ label: string; preview: number; breakpoint: number }> = [
  { label: "Fit", preview: 0, breakpoint: 0 },
  { label: "Phone", preview: 390, breakpoint: 640 },
  { label: "Tablet", preview: 820, breakpoint: 900 },
  { label: "Laptop", preview: 1280, breakpoint: 0 },
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

/** Six digits, or nothing, so mixing never has to guess. */
function hexOf(value: string): string | null {
  const raw = String(value ?? "").trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(raw);
  if (short) {
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  }
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : null;
}

/** The same mix the site's own stylesheet makes, worked out here as a number. */
function blend(front: string, back: string, share: number): string {
  const one = hexOf(front);
  const two = hexOf(back);
  if (!one || !two) return one ?? two ?? "#000000";
  const part = (at: number) => {
    const x = parseInt(one.slice(at, at + 2), 16);
    const y = parseInt(two.slice(at, at + 2), 16);
    return Math.round(x * share + y * (1 - share))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${part(1)}${part(3)}${part(5)}`;
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
  onSelect,
  clip,
  onClip,
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
  /**
   * What is selected, passed outward.
   *
   * So that the panel which edits by description can be told what is being
   * pointed at. "Rewrite this paragraph" is the most natural thing to ask about
   * something you have just clicked, and it needs to know which paragraph.
   */
  onSelect?: (chosen: Selected | null) => void;
  /**
   * A block copied from a page, kept above this so it survives changing pages.
   *
   * The whole point of copying one is to put it on a different page, and this
   * component is rebuilt from nothing when the page changes.
   */
  clip: Clip | null;
  onClip: (clip: Clip | null) => void;
  /** Which website this is, so its own picture library can be opened. */
  websiteId: string;
  dirty: boolean;
  saving: boolean;
}) {
  const ask = useAsk();
  const frame = useRef<HTMLIFrameElement>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [tab, setTab] = useState<"type" | "box">("type");
  const [full, setFull] = useState(false);
  const [size, setSize] = useState(0);
  /**
   * Which width a style set now applies to. Zero is every width.
   *
   * Off by default, even while looking at a phone. A style that silently
   * applied to one width only would be a style somebody sets, scrolls away
   * from, and never sees again on the width they were designing for.
   */
  const [width, setWidth] = useState(0);
  /** Snapshots either side of where we are. A rescue, not a history. */
  const [past, setPast] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  /** The page's top-level blocks, as the frame last described them. */
  const [rows, setRows] = useState<Row[]>([]);
  /** Whether the picture library is open, and where what it returns should go. */
  const [picking, setPicking] = useState(false);
  /** Whether the block library is open. */
  const [adding, setAdding] = useState(false);

  const blocks = useRef<HTMLDialogElement>(null);

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

  /*
   * Stepping back, and stepping forward again.
   *
   * Redo was the missing half. Undo without it is a trapdoor: one press too
   * many and the only way back is to type it again, which is why people stop
   * using undo to look at what something was and start using it only when they
   * are certain.
   */
  const undo = useCallback(() => {
    if (!past.length) return;
    const previous = past[past.length - 1]!;
    setFuture((rows) => [...rows, page?.bodyHtml ?? ""].slice(-40));
    setPast(past.slice(0, -1));
    send({ do: "replace", html: previous });
    onChange(previous);
  }, [onChange, page?.bodyHtml, past, send]);

  const redo = useCallback(() => {
    if (!future.length) return;
    const next = future[future.length - 1]!;
    setPast((rows) => [...rows, page?.bodyHtml ?? ""].slice(-40));
    setFuture(future.slice(0, -1));
    send({ do: "replace", html: next });
    onChange(next);
  }, [future, onChange, page?.bodyHtml, send]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as Record<string, unknown> | null;
      if (!data) return;

      if (data.preview === "selected") {
        const found = (data.element as Chosen | null) ?? null;
        setChosen(found);
        onSelect?.(
          found
            ? {
                label: found.label,
                path: found.path,
                where: found.where ?? "page",
                text: found.text ?? "",
                html: found.html ?? "",
              }
            : null,
        );
        return;
      }

      if (data.preview === "outline") {
        const next = (data.rows as Row[]) ?? [];
        // The frame describes the page on every selection, and a selection
        // happens on every keystroke that moves the caret. A new array each
        // time would redraw the outline continuously while somebody types.
        setRows((was) => (JSON.stringify(was) === JSON.stringify(next) ? was : next));
        return;
      }

      if (data.preview === "copied") {
        onClip({
          html: String(data.html ?? ""),
          label: String(data.label ?? "block"),
          // The rules the block was wearing, so it arrives on the other page
          // looking the way it looked on this one.
          styles: (data.styles as Clip["styles"]) ?? null,
        });
        return;
      }

      // The frame is new, so it knows nothing about which width is being
      // styled. Told rather than assumed, because the default is every width
      // and a stale frame would write to the wrong one silently.
      if (data.preview === "ready") {
        send({ do: "media", px: width });
        return;
      }

      if (data.preview === "history") {
        if (data.back) undo();
        else redo();
        return;
      }

      if (data.preview === "save") {
        if (dirty && !saving) onSave();
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
          // A fresh edit is a new branch. Anything that was ahead of here is
          // no longer ahead of anything.
          setFuture([]);
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
  }, [
    dirty,
    onChange,
    onChromeStyle,
    onClip,
    onNavigate,
    onSave,
    onSelect,
    onSetting,
    onTitle,
    page?.bodyHtml,
    pages,
    redo,
    saving,
    send,
    undo,
    width,
  ]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [full]);

  /*
   * The same keys, pressed outside the frame.
   *
   * Half the time the cursor is in the page and the frame hears them; half the
   * time it is in a field in the panel and this does. A shortcut that works
   * only when you last clicked in the right place is a shortcut nobody trusts.
   *
   * Except in a field, where the browser's own undo is the right one: rewinding
   * the whole page because somebody mistyped a colour would be a surprise.
   */
  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;

      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editable, redo, undo]);

  // Told whenever it changes, rather than sent along with each style, so the
  // frame is the one place that knows which width is being written to.
  useEffect(() => {
    send({ do: "media", px: width });
  }, [send, width]);

  useEffect(() => {
    const el = blocks.current;
    if (!el) return;
    if (adding && !el.open) el.showModal();
    else if (!adding && el.open) el.close();
  }, [adding]);

  if (!page) return <div className="empty">Nothing to edit yet.</div>;

  const controls = tab === "type" ? TYPE : BOX;
  const scoped = width > 0;
  /** The header and footer are rendered from a template, so no rule can be hung on them. */
  const scopable = chosen?.where !== "chrome";

  /*
   * The site's own colours, offered before any others.
   *
   * A colour picker full of every colour is a colour picker that produces a
   * page in colours the site does not use. These are the three the site was
   * built from and the mixes its own stylesheet makes from them, so picking one
   * keeps the page on the palette rather than near it.
   */
  const swatches = ([
    [site.theme.accent, "Accent"],
    [site.theme.ink, "Text"],
    [site.theme.background, "Background"],
    [blend(site.theme.ink, site.theme.background, 0.62), "Muted text"],
    [blend(site.theme.accent, site.theme.background, 0.08), "Accent tint"],
    [blend(site.theme.ink, site.theme.background, 0.05), "Panel"],
    [blend(site.theme.ink, site.theme.background, 0.13), "Hairline"],
    ["#ffffff", "White"],
    ["#000000", "Black"],
  ] as Array<[string, string]>).filter(
    // Most sites are on a white background, and two identical white squares
    // side by side read as one of them being broken.
    (one, at, all) => all.findIndex(([colour]) => hexOf(colour) === hexOf(one[0])) === at,
  );

  return (
    <div className={full ? "ve preview-shell is-full" : "ve preview-shell"}>
      <div className="ve-bar">
        {editable ? (
          <>
            <button
              type="button"
              className="btn btn-primary btn-sm ve-add"
              onClick={() => setAdding(true)}
              title="Put a new section into the page"
            >
              <span aria-hidden>+</span> Add
            </button>

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
                  // The dialog answers a promise, and an onClick cannot wait
                  // for one, so the waiting happens beside it.
                  void (async () => {
                    const url = await ask.prompt({
                      title: "Add a link",
                      label: "Where should it go?",
                      placeholder: "https://example.com/page/",
                      confirmLabel: "Add the link",
                      // Anything without a scheme becomes a link relative to
                      // this page, which is almost never what somebody typing
                      // a whole address meant.
                      validate: (value) =>
                        /^(https?:[/][/]|[/]|#|mailto:)/i.test(value)
                          ? null
                          : "Start with https://, or with / for a page on this site.",
                    });
                    if (url) send({ do: "exec", command: "createLink", argument: url });
                  })();
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

            {/*
              * Taking a block from one page to another.
              *
              * Duplicate has always worked in place. Getting a section onto a
              * different page meant opening the markup, finding where it
              * started and where it ended, and moving it by hand — which is the
              * one job this editor exists to make unnecessary.
              */}
            <div className="seg seg-sm">
              <button
                type="button"
                className="seg-btn"
                disabled={!chosen}
                title={chosen ? "Copy this, to paste on any page" : "Select something first"}
                onClick={() => send({ do: "copy" })}
              >
                Copy
              </button>
              <button
                type="button"
                className="seg-btn"
                disabled={!clip}
                title={clip ? `Paste the ${clip.label} you copied` : "Nothing copied yet"}
                onClick={() =>
                  clip && send({ do: "insert", html: clip.html, styles: clip.styles })
                }
              >
                Paste
              </button>
            </div>

            <div className="seg seg-sm">
              <button
                type="button"
                className="seg-btn"
                onClick={undo}
                disabled={!past.length}
                title="Undo (Ctrl+Z)"
              >
                Undo
              </button>
              <button
                type="button"
                className="seg-btn"
                onClick={redo}
                disabled={!future.length}
                title="Redo (Ctrl+Shift+Z)"
              >
                Redo
              </button>
            </div>
          </>
        ) : null}

        <div className="seg seg-sm ve-widths">
          {WIDTHS.map((one) => (
            <button
              key={one.label}
              type="button"
              className={size === one.preview ? "seg-btn is-on" : "seg-btn"}
              onClick={() => {
                setSize(one.preview);
                /*
                 * Always back to every width, not only when the new one has no
                 * breakpoint of its own. Going from Phone to Tablet without
                 * this left the panel writing phone rules while showing a
                 * tablet, which is a change landing at a width nobody is
                 * looking at.
                 */
                setWidth(0);
              }}
            >
              {one.label}
            </button>
          ))}
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

      {/*
        * The block library.
        *
        * A dialog rather than a dropdown, because it is also reachable from
        * full screen, where a menu anchored to a toolbar has nothing behind it
        * to sit on. Everything in it is made from the site's own classes, so
        * what arrives is already the right colour and the right typeface.
        */}
      <dialog
        ref={blocks}
        className="confirm ve-blocks"
        aria-labelledby="ve-blocks-title"
        onClose={() => setAdding(false)}
        onClick={(event) => {
          if (event.target === blocks.current) setAdding(false);
        }}
      >
        <div className="confirm-card ve-blocks-card">
          <div className="ve-blocks-head">
            <div>
              <h3 id="ve-blocks-title" className="confirm-title">
                Add to the page
              </h3>
              <p className="quiet">
                {chosen
                  ? "It goes in after whatever is selected."
                  : "It goes in at the end of the page."}
              </p>
            </div>
            <button
              type="button"
              className="ask-close"
              title="Close"
              aria-label="Close"
              onClick={() => setAdding(false)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <div className="ve-blocks-body">
            {BLOCK_GROUPS.map((group) => (
              <section key={group} className="ve-blocks-group">
                <h4>{group}</h4>
                <div className="ve-blocks-grid">
                  {BLOCKS.filter((b) => b.group === group).map((block) => (
                    <button
                      key={block.key}
                      type="button"
                      className="ve-block"
                      onClick={() => {
                        send({ do: "insert", html: block.html });
                        setAdding(false);
                      }}
                    >
                      <strong>{block.name}</strong>
                      <span>{block.hint}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      </dialog>

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
            {/*
              * The page from the side.
              *
              * The breadcrumbs walk upward only, so on a long page there was no
              * way to see what the page is made of or move between its parts
              * without scrolling and aiming. Open by default when nothing is
              * selected, which is exactly when somebody is looking for
              * something.
              */}
            <details className="ve-outline" open={!chosen}>
              <summary>
                Page outline <span className="ve-outline-count">{rows.length}</span>
              </summary>
              <ol className="ve-outline-list">
                {rows.map((row) => (
                  <li key={row.at}>
                    <button
                      type="button"
                      className={row.here ? "ve-outline-row is-on" : "ve-outline-row"}
                      onClick={() => send({ do: "choose", at: row.at })}
                    >
                      <span className="ve-outline-tag">{row.heading || row.label}</span>
                      <span className="ve-outline-text">{row.text || "…"}</span>
                    </button>
                  </li>
                ))}
                {!rows.length ? <li className="quiet">Nothing on the page yet.</li> : null}
              </ol>
            </details>

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

                {/*
                  * Which width the next change applies to.
                  *
                  * Only offered where the width being previewed has a
                  * breakpoint to hang a rule on, and only inside the page: the
                  * header and footer are built from a template every render, so
                  * there is no element there for a rule to keep pointing at.
                  */}
                {WIDTHS.some((w) => w.preview === size && w.breakpoint) && scopable ? (
                  <div className="ve-at">
                    <div className="seg seg-sm">
                      <button
                        type="button"
                        className={!scoped ? "seg-btn is-on" : "seg-btn"}
                        onClick={() => setWidth(0)}
                      >
                        Every width
                      </button>
                      <button
                        type="button"
                        className={scoped ? "seg-btn is-on" : "seg-btn"}
                        onClick={() =>
                          setWidth(WIDTHS.find((w) => w.preview === size)?.breakpoint ?? 0)
                        }
                      >
                        This width down
                      </button>
                    </div>
                    {scoped ? (
                      <p className="ve-note">
                        Changes now apply below {width} pixels only, and override
                        what is set for every width.
                      </p>
                    ) : null}
                  </div>
                ) : null}

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
                  /*
                   * What the box shows.
                   *
                   * Styling every width shows what the element actually looks
                   * like, set or inherited. Styling one width shows only what
                   * is set for that width, because that is the only thing the
                   * box can change and the only thing clearing it removes.
                   * Showing the inherited value there would read as a value set
                   * at this width and never cleared.
                   */
                  const value = scoped
                    ? chosen.atWidth?.[control.key] ?? ""
                    : chosen.styles[control.key] ?? "";
                  const inherited = chosen.styles[control.key] ?? "";

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
                                  : value || inherited,
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

                          <div className="ve-swatches">
                            {swatches.map(([colour, name]) => (
                              <button
                                key={`${control.key}-${name}`}
                                type="button"
                                className="ve-swatch"
                                style={{ background: colour }}
                                title={`${name} — ${colour}`}
                                aria-label={name}
                                onClick={() =>
                                  send({ do: "style", key: control.key, value: colour })
                                }
                              />
                            ))}
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
                          key={`${chosen.label}-${control.key}-${width}-${value}`}
                          placeholder={scoped ? inherited || "inherit" : "inherit"}
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
