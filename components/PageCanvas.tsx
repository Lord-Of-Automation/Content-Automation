"use client";

import { useEffect, useRef } from "react";

/**
 * The page as it will look, and editable where it stands.
 *
 * Two problems solved by one surface. Nothing in the console rendered a
 * generated page at all, so the only way to judge what the AI wrote was to read
 * its markup. And editing prose inside HTML means finding the sentence between
 * the tags, which is a poor way to fix a sentence.
 *
 * Rendered into the page rather than an iframe. An iframe would sandbox the
 * markup for free, but a sandboxed one cannot be reached into to read edits
 * back, and an unsandboxed srcdoc iframe is the same origin as the console with
 * extra steps. So the markup is cleaned first and rendered in place, which is
 * both safer than the iframe that was easy and simpler than the one that was
 * correct.
 *
 * What cleaning removes is anything that executes or reaches out: scripts,
 * styles, embedded frames, event handlers and javascript: addresses. This is
 * our own generated content rather than a stranger's, and that is exactly the
 * reasoning that makes people skip it — a model that can be told what to write
 * can be told what to write by somebody else's web page it read on the way.
 */

/** Everything that runs, loads, or restyles the console around it. */
const STRIP = "script, style, link, meta, iframe, object, embed, form, base, noscript";

export function cleanHtml(html: string): string {
  if (typeof window === "undefined") return "";

  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(STRIP).forEach((node) => node.remove());

  for (const el of Array.from(doc.querySelectorAll("*"))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      // Handlers run on click, on load, on anything.
      if (name.startsWith("on")) {
        el.removeAttribute(attr.name);
        continue;
      }
      // A link that is really a script.
      if (
        (name === "href" || name === "src" || name === "xlink:href") &&
        /^\s*javascript:/i.test(attr.value)
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }

  return doc.body.innerHTML;
}

export default function PageCanvas({
  html,
  editable,
  onChange,
}: {
  html: string;
  /** Off while a build is still writing: editing a moving page loses edits. */
  editable: boolean;
  onChange: (html: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);

  /**
   * Written imperatively, and only when the page underneath changes.
   *
   * React must not own this subtree. Re-rendering an element that somebody is
   * typing into replaces the nodes their cursor is in, and the caret jumps to
   * the top on every keystroke — which is the classic way a contenteditable
   * bound to state becomes unusable.
   */
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const cleaned = cleanHtml(html);
    if (el.innerHTML !== cleaned) el.innerHTML = cleaned;
    // Only on a genuine page change. `html` changing because of a keystroke in
    // this very element must not write it back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, host.current === null]);

  useEffect(() => {
    const el = host.current;
    if (el) el.innerHTML = cleanHtml(html);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html.length === 0]);

  return (
    <div
      ref={host}
      className={editable ? "canvas is-editable" : "canvas"}
      contentEditable={editable}
      suppressContentEditableWarning
      spellCheck
      // Read back on blur rather than on every keystroke. Reading innerHTML on
      // input would rewrite the markup mid-word, and browsers normalise it as
      // they go, so the text would shift under the cursor.
      onBlur={(e) => {
        if (!editable) return;
        const next = (e.target as HTMLDivElement).innerHTML;
        if (next !== html) onChange(next);
      }}
      // Paste as text. Pasting from a word processor otherwise drags in a
      // paragraph of foreign markup and a font stack nobody asked for.
      onPaste={(e) => {
        if (!editable) return;
        e.preventDefault();
        const text = e.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, text);
      }}
    />
  );
}
