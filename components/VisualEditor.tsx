"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cleanHtml } from "@/components/PageCanvas";

/**
 * Editing a page by pointing at it.
 *
 * The text editor before this let you rewrite the words and nothing else. A
 * page is not only words: it is what size they are, what colour, how much room
 * they have, and what sits beside them. Changing any of that meant opening the
 * markup, which is the thing an editor exists to avoid.
 *
 * How it works, and why it works this way:
 *
 * The page is real HTML in a real contenteditable, not a block model. Blocks
 * are what a site builder uses when it owns the markup from the start; this
 * markup arrives written by something else, with its own classes and its own
 * stylesheet, and parsing that into blocks would lose most of it and mangle the
 * rest. So the document stays as it is and edits are made to it directly.
 *
 * Selection follows the caret rather than being a mode of its own. Clicking
 * into a paragraph to type also selects that paragraph, so there is no
 * "select" tool to switch to and nothing to remember.
 *
 * Changes are written as inline styles. They win over the page's own
 * stylesheet, which is what somebody adjusting one heading means, and they
 * travel with the element if it moves. What the panel shows is the computed
 * value, so an untouched element reads what it actually looks like rather than
 * blank.
 *
 * Nothing here runs the page's own scripts or styles: the markup is cleaned on
 * the way in, exactly as the read-only canvas cleans it, because this surface
 * is the console and a script here would arrive holding the console's session.
 */

/** What the panel needs to know about whatever is selected. */
interface Selected {
  tag: string;
  /** "h2.title", for the breadcrumb. */
  label: string;
  /** The trail from the page down to it, so a parent can be reached. */
  path: string[];
  isImage: boolean;
  isLink: boolean;
}

const FONTS: Array<[string, string]> = [
  ["", "Inherit from the page"],
  ["system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", "System sans"],
  ["Georgia, 'Times New Roman', serif", "Serif"],
  ["'Iowan Old Style', Palatino, Georgia, serif", "Old style serif"],
  ["ui-monospace, SFMono-Regular, Menlo, monospace", "Monospace"],
  ["'Trebuchet MS', 'Segoe UI', sans-serif", "Humanist"],
];

const WEIGHTS = ["", "300", "400", "500", "600", "700", "800"];
const ALIGNS = ["", "left", "center", "right"];

/** A style property the panel can set, and how it is shown. */
interface Control {
  key: string;
  label: string;
  kind: "length" | "colour" | "select" | "text";
  options?: Array<[string, string]>;
  /** Suffix added when a bare number is typed, so "18" means 18px. */
  unit?: string;
}

const TYPOGRAPHY: Control[] = [
  { key: "fontSize", label: "Size", kind: "length", unit: "px" },
  { key: "fontWeight", label: "Weight", kind: "select", options: WEIGHTS.map((w) => [w, w || "Inherit"]) },
  { key: "fontFamily", label: "Typeface", kind: "select", options: FONTS },
  { key: "color", label: "Colour", kind: "colour" },
  { key: "lineHeight", label: "Line height", kind: "text" },
  { key: "letterSpacing", label: "Letter spacing", kind: "length", unit: "px" },
  { key: "textAlign", label: "Align", kind: "select", options: ALIGNS.map((a) => [a, a || "Inherit"]) },
];

const BOX: Control[] = [
  { key: "width", label: "Width", kind: "length", unit: "px" },
  { key: "height", label: "Height", kind: "length", unit: "px" },
  { key: "maxWidth", label: "Max width", kind: "length", unit: "px" },
  { key: "padding", label: "Padding", kind: "length", unit: "px" },
  { key: "margin", label: "Margin", kind: "length", unit: "px" },
  { key: "backgroundColor", label: "Background", kind: "colour" },
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
  return (
    "#" +
    [m[1], m[2], m[3]]
      .map((n) => Number(n).toString(16).padStart(2, "0"))
      .join("")
  );
}

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const cls = (el.getAttribute("class") ?? "").trim().split(/\s+/).filter(Boolean)[0];
  return cls ? `${tag}.${cls}` : tag;
}

export default function VisualEditor({
  html,
  editable,
  onChange,
}: {
  html: string;
  editable: boolean;
  onChange: (html: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chosen = useRef<HTMLElement | null>(null);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [selected, setSelected] = useState<Selected | null>(null);
  const [tab, setTab] = useState<"text" | "box">("text");
  /** Snapshots for undo, newest last. Capped: this is a rescue, not history. */
  const [past, setPast] = useState<string[]>([]);

  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current);
  }, []);

  // Same rule as the read-only canvas: filled once while editable, tracked
  // while not, so a page arriving mid-build still appears.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (editable && el.innerHTML !== "") return;
    const cleaned = cleanHtml(html);
    if (el.innerHTML !== cleaned) el.innerHTML = cleaned;
  }, [html, editable]);

  /**
   * The markup, with the editor's own marks taken back out.
   *
   * The selection outline is an attribute on the element rather than a floating
   * overlay, because an overlay has to be repositioned on every scroll, resize
   * and edit and is wrong for a moment each time. The cost is remembering to
   * strip it, which happens here, in the one place the markup leaves.
   */
  const serialise = useCallback((): string => {
    const el = host.current;
    if (!el) return html;
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("[data-chosen]").forEach((n) => n.removeAttribute("data-chosen"));
    return copy.innerHTML;
  }, [html]);

  const report = useCallback(
    (immediate = false) => {
      if (!editable) return;
      if (pending.current) clearTimeout(pending.current);
      const send = () => {
        const next = serialise();
        if (next !== html) onChange(next);
      };
      if (immediate) send();
      else pending.current = setTimeout(send, 250);
    },
    [editable, html, onChange, serialise],
  );

  /** Remember where we were, before changing anything. */
  const remember = useCallback(() => {
    setPast((rows) => [...rows, serialise()].slice(-40));
  }, [serialise]);

  /** Mark an element as the one being worked on, and describe it upward. */
  const choose = useCallback((el: HTMLElement | null) => {
    const root = host.current;
    if (!root) return;

    root.querySelectorAll("[data-chosen]").forEach((n) => n.removeAttribute("data-chosen"));
    chosen.current = el;

    if (!el || el === root) {
      setSelected(null);
      return;
    }

    el.setAttribute("data-chosen", "");

    const path: string[] = [];
    for (let node: Element | null = el; node && node !== root; node = node.parentElement) {
      path.unshift(describe(node));
    }

    setSelected({
      tag: el.tagName.toLowerCase(),
      label: describe(el),
      path,
      isImage: el.tagName === "IMG",
      isLink: el.tagName === "A",
    });
  }, []);

  /**
   * Selection follows the caret.
   *
   * Listening on the document rather than the element, because the browser
   * moves the caret for arrow keys and clicks alike and only the document is
   * told about all of it.
   */
  useEffect(() => {
    if (!editable) return;

    function onSelectionChange() {
      const root = host.current;
      const sel = document.getSelection();
      if (!root || !sel || sel.rangeCount === 0) return;

      const node = sel.anchorNode;
      if (!node || !root.contains(node)) return;

      const el = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
      if (el && el !== chosen.current) choose(el);
    }

    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, [editable, choose]);

  /** What the panel should show for one property, computed when unset. */
  const valueOf = useCallback((key: string): string => {
    const el = chosen.current;
    if (!el) return "";
    const inline = (el.style as unknown as Record<string, string>)[key];
    if (inline) return inline;
    const computed = getComputedStyle(el)[key as keyof CSSStyleDeclaration];
    return typeof computed === "string" ? computed : "";
  }, []);

  const apply = useCallback(
    (key: string, value: string) => {
      const el = chosen.current;
      if (!el) return;
      remember();
      (el.style as unknown as Record<string, string>)[key] = value;
      report(true);
      // Re-read so the panel shows what was actually accepted.
      setSelected((s) => (s ? { ...s } : s));
    },
    [remember, report],
  );

  /** Wrap or unwrap the current text selection. */
  const format = useCallback(
    (command: string, argument?: string) => {
      if (!editable) return;
      remember();
      document.execCommand(command, false, argument);
      report(true);
    },
    [editable, remember, report],
  );

  const undo = useCallback(() => {
    setPast((rows) => {
      if (!rows.length) return rows;
      const previous = rows[rows.length - 1]!;
      const el = host.current;
      if (el) {
        el.innerHTML = cleanHtml(previous);
        choose(null);
        onChange(previous);
      }
      return rows.slice(0, -1);
    });
  }, [choose, onChange]);

  const remove = useCallback(() => {
    const el = chosen.current;
    if (!el || el === host.current) return;
    remember();
    el.remove();
    choose(null);
    report(true);
  }, [choose, remember, report]);

  const duplicate = useCallback(() => {
    const el = chosen.current;
    if (!el || el === host.current) return;
    remember();
    const copy = el.cloneNode(true) as HTMLElement;
    copy.removeAttribute("data-chosen");
    el.after(copy);
    report(true);
  }, [remember, report]);

  /** Put a picture where the caret is, or change the one selected. */
  const setImage = useCallback(
    (src: string, alt: string) => {
      const el = chosen.current;
      remember();
      if (el && el.tagName === "IMG") {
        el.setAttribute("src", src);
        el.setAttribute("alt", alt);
      } else {
        document.execCommand(
          "insertHTML",
          false,
          `<img src="${src.replace(/"/g, "&quot;")}" alt="${alt.replace(/"/g, "&quot;")}">`,
        );
      }
      report(true);
    },
    [remember, report],
  );

  const controls = tab === "text" ? TYPOGRAPHY : BOX;

  const crumbs = useMemo(() => selected?.path ?? [], [selected]);

  return (
    <div className="ve">
      <div className="ve-bar">
        <div className="seg seg-sm">
          {(["B", "I", "U"] as const).map((mark, i) => (
            <button
              key={mark}
              type="button"
              className="seg-btn"
              title={["Bold", "Italic", "Underline"][i]}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => format(["bold", "italic", "underline"][i]!)}
              disabled={!editable}
            >
              <span style={{ fontWeight: mark === "B" ? 700 : 500, fontStyle: mark === "I" ? "italic" : "normal", textDecoration: mark === "U" ? "underline" : "none" }}>
                {mark}
              </span>
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
              onClick={() => format("formatBlock", block)}
              disabled={!editable}
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
              if (url) format("createLink", url);
            }}
            disabled={!editable}
          >
            Link
          </button>
          <button
            type="button"
            className="seg-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const src = window.prompt("Image address");
              if (!src) return;
              setImage(src, window.prompt("Describe it, for anyone who cannot see it") ?? "");
            }}
            disabled={!editable}
          >
            Image
          </button>
        </div>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={undo}
          disabled={!past.length}
          title="Undo the last change"
        >
          Undo
        </button>
      </div>

      <div className="ve-body">
        <div
          ref={host}
          className={editable ? "canvas is-editable" : "canvas"}
          contentEditable={editable}
          suppressContentEditableWarning
          spellCheck
          onInput={() => report()}
          onBlur={() => report(true)}
          onPaste={(e) => {
            if (!editable) return;
            e.preventDefault();
            document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
          }}
        />

        <aside className="ve-panel">
          {!selected ? (
            <p className="provider-hint">
              Click anything on the page to change how it looks. Typing works
              wherever the cursor is.
            </p>
          ) : (
            <>
              <div className="ve-crumbs">
                {crumbs.map((name, i) => (
                  <button
                    key={`${name}-${i}`}
                    type="button"
                    className={i === crumbs.length - 1 ? "ve-crumb is-on" : "ve-crumb"}
                    title="Select this one instead"
                    onClick={() => {
                      // Walk up from the current element by however many steps
                      // separate it from the crumb that was clicked.
                      let el = chosen.current;
                      for (let up = crumbs.length - 1 - i; up > 0 && el; up -= 1) {
                        el = el.parentElement;
                      }
                      choose(el ?? null);
                    }}
                  >
                    {name}
                  </button>
                ))}
              </div>

              <div className="seg seg-sm ve-tabs">
                <button
                  type="button"
                  className={tab === "text" ? "seg-btn is-on" : "seg-btn"}
                  onClick={() => setTab("text")}
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

              {selected.isImage ? (
                <div className="ve-field">
                  <label className="field-label">Image address</label>
                  <input
                    type="text"
                    defaultValue={chosen.current?.getAttribute("src") ?? ""}
                    onBlur={(e) => {
                      remember();
                      chosen.current?.setAttribute("src", e.target.value);
                      report(true);
                    }}
                  />
                  <label className="field-label">Description</label>
                  <input
                    type="text"
                    defaultValue={chosen.current?.getAttribute("alt") ?? ""}
                    onBlur={(e) => {
                      remember();
                      chosen.current?.setAttribute("alt", e.target.value);
                      report(true);
                    }}
                  />
                </div>
              ) : null}

              {selected.isLink ? (
                <div className="ve-field">
                  <label className="field-label">Links to</label>
                  <input
                    type="text"
                    defaultValue={chosen.current?.getAttribute("href") ?? ""}
                    onBlur={(e) => {
                      remember();
                      chosen.current?.setAttribute("href", e.target.value);
                      report(true);
                    }}
                  />
                </div>
              ) : null}

              {controls.map((control) => (
                <div className="ve-field" key={control.key}>
                  <label className="field-label">{control.label}</label>
                  {control.kind === "select" ? (
                    <select
                      value={valueOf(control.key)}
                      onChange={(e) => apply(control.key, e.target.value)}
                    >
                      {(control.options ?? []).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  ) : control.kind === "colour" ? (
                    <div className="ve-colour">
                      <input
                        type="color"
                        className="colour-input"
                        value={toHex(valueOf(control.key))}
                        onChange={(e) => apply(control.key, e.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => apply(control.key, "")}
                        title="Back to whatever the page says"
                      >
                        Clear
                      </button>
                    </div>
                  ) : (
                    <input
                      type="text"
                      defaultValue={valueOf(control.key)}
                      key={`${selected.label}-${control.key}-${valueOf(control.key)}`}
                      placeholder="inherit"
                      onBlur={(e) => apply(control.key, withUnit(e.target.value, control.unit))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                    />
                  )}
                </div>
              ))}

              <div className="ve-actions">
                <button type="button" className="btn btn-ghost btn-sm" onClick={duplicate}>
                  Duplicate
                </button>
                <button type="button" className="btn btn-danger btn-sm" onClick={remove}>
                  Delete
                </button>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
