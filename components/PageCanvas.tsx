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
 *
 * Pages are allowed to carry behaviour, and it still does not run here. The
 * preview next door runs it, in a frame that is its own origin and can reach
 * nothing; this surface is the console itself, where a script would arrive with
 * the console's cookies. So the stripping stays, and what is removed is
 * reported instead, because an editor that silently drops half a page is worse
 * than one that refuses to run it.
 */

/** Everything that runs, loads, or restyles the console around it. */
const STRIP = "script, style, link, meta, iframe, object, embed, form, base, noscript";

/**
 * Whether a page carries anything this surface will not run.
 *
 * Used by the editor to say so out loud. Cheap and deliberately rough: a false
 * positive puts a true sentence on screen about a page that mentions a script
 * tag, which costs nothing.
 */
export function hasBehaviour(html: string): boolean {
  return /<script[\s>]|<style[\s>]|\son[a-z]+\s*=/i.test(html);
}

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
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A pending read must not fire into a component that has gone.
  useEffect(() => () => {
    if (pending.current) clearTimeout(pending.current);
  }, []);

  /**
   * Written imperatively, on different terms depending on who is typing.
   *
   * React must not own this subtree while it is editable. Re-rendering an
   * element somebody is typing into replaces the nodes their caret sits in, so
   * the cursor jumps to the top on every keystroke, which is the classic way a
   * contenteditable bound to state becomes unusable. Once editable it is filled
   * on mount and then left alone; the parent gives it a key per page, so moving
   * to another page is a fresh mount rather than a rewrite.
   *
   * Read-only is the opposite. There is no cursor to lose, and the content does
   * change underneath while a build is still writing, so it tracks and pages
   * appear as they land.
   */
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (editable && el.innerHTML !== "") return;

    const cleaned = cleanHtml(html);
    if (el.innerHTML !== cleaned) el.innerHTML = cleaned;
  }, [html, editable]);

  return (
    <div
      ref={host}
      className={editable ? "canvas is-editable" : "canvas"}
      contentEditable={editable}
      suppressContentEditableWarning
      spellCheck
      /**
       * Read back as you type, a beat behind.
       *
       * This used to wait for blur, which was safe and made the preview beside
       * it useless: nothing moved until you clicked away. Reporting on every
       * keystroke is what makes a live preview live.
       *
       * Safe here only because of the effect above. Telling the parent does not
       * bring the markup back into this element, so the caret stays where it
       * is — the thing that breaks a contenteditable is being re-rendered, not
       * being read.
       *
       * Delayed by a beat all the same. Reading innerHTML on every key is work
       * for a preview nobody can read mid-word, and the pause costs nothing.
       */
      onInput={(e) => {
        if (!editable) return;
        const el = e.currentTarget;
        if (pending.current) clearTimeout(pending.current);
        pending.current = setTimeout(() => {
          const next = el.innerHTML;
          if (next !== html) onChange(next);
        }, 250);
      }}
      onBlur={(e) => {
        if (!editable) return;
        // Whatever the pause was still holding, without waiting for it.
        if (pending.current) clearTimeout(pending.current);
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
