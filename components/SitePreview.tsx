"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { renderPage, type ShellPage, type ShellSite } from "@/lib/siteshell";

/**
 * Widths worth checking, and no more than that.
 *
 * The frame's own width is the viewport for the document inside it, so setting
 * it to 390 genuinely triggers the site's phone breakpoints rather than
 * simulating them. That is the whole reason this works with three lines of
 * state instead of a device emulator.
 *
 * Four, chosen where layouts actually break rather than to match real hardware.
 * A list of thirty phones is a list nobody reads, and the two either side of a
 * breakpoint are the only ones that ever told anyone anything.
 */
const SIZES: Array<{ id: string; label: string; width: number }> = [
  { id: "auto", label: "Fit", width: 0 },
  { id: "phone", label: "Phone", width: 390 },
  { id: "tablet", label: "Tablet", width: 820 },
  { id: "laptop", label: "Laptop", width: 1280 },
];

/**
 * The whole site, as a visitor would meet it.
 *
 * The editor's visual mode shows one page's body, which is the right thing for
 * editing and the wrong thing for judging. A body with no header, no navigation
 * and no footer around it is not a website, and until this existed there was
 * nowhere to see one.
 *
 * In an iframe, unlike the editing canvas next door, and for the opposite
 * reason. Nothing here needs reading back, so the frame can be sandboxed
 * properly: scripts allowed, the same origin denied. That makes it a separate
 * origin that can post a message to this window and touch nothing else of it,
 * which is exactly enough for the navigation to work and no more.
 *
 * The document it renders is the same one the export writes to a file. A
 * preview built beside an exporter drifts from it; a preview that calls the
 * exporter cannot.
 *
 * The width control is not an emulator. A frame's own width is the viewport for
 * the document inside it, so holding it at 390 makes the site's phone
 * breakpoints fire for real, which is why this is three lines of state rather
 * than a device simulator.
 */
export default function SitePreview({
  site,
  pages,
  current,
  onNavigate,
}: {
  site: Omit<ShellSite, "pages">;
  pages: ShellPage[];
  /** The slug being shown. Empty is the front page. */
  current: string;
  onNavigate: (slug: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);

  /**
   * Whether the preview has the whole window.
   *
   * A preview at a third of the width shows you a layout, not a page. This is a
   * class rather than the Fullscreen API: no permission to ask for, the same
   * behaviour in every browser, and a way out that is always visible.
   */
  const [full, setFull] = useState(false);

  /** Which width the frame is held at. Zero fills whatever room there is. */
  const [size, setSize] = useState(0);

  // Escape closes it, because anything covering the window has to.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFull(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [full]);

  const shell: ShellSite = useMemo(() => ({ ...site, pages }), [site, pages]);

  const page = useMemo(
    () => pages.find((p) => p.slug === current) ?? pages[0],
    [pages, current],
  );

  const html = useMemo(
    () =>
      page
        ? renderPage(shell, page, {
            current,
            interactive: true,
            // Passed in rather than read inside the renderer, which stays pure
            // so the preview and the export produce the same bytes.
            year: new Date().getFullYear(),
          })
        : "",
    [shell, page, current],
  );

  /**
   * A click on a link inside the frame, arriving as a message.
   *
   * Checked for shape rather than origin, because a sandboxed frame without
   * same-origin access has the opaque origin "null" and there is nothing useful
   * to compare against. What it can do is post an object, and all that is done
   * with it is match a slug against pages this component already has — so a
   * message from anywhere else can at worst name a page that does not exist.
   */
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { preview?: string; href?: string } | null;
      if (!data || data.preview !== "go") return;

      const href = String(data.href ?? "").trim();

      /**
       * Somewhere else entirely.
       *
       * Opened in a tab rather than followed here: the frame cannot go there,
       * and silently doing nothing when somebody clicks a real link reads as a
       * broken preview.
       */
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        if (/^https?:/i.test(href)) window.open(href, "_blank", "noopener,noreferrer");
        return;
      }

      /**
       * A page of this site, however the link happened to spell it.
       *
       * The interceptor used to take only addresses beginning with a slash, so
       * a link written as "about.html" or "about" escaped it, navigated the
       * frame to the console's own address, and landed on the sign-in page.
       * Every shape is reduced to a slug here instead.
       */
      const slug = href
        .replace(/[?#].*$/, "")
        .replace(/^[./]+/, "")
        .replace(/\.html?$/i, "")
        .replace(/\/$/, "");

      // index.html and an empty address are both the front page.
      const wanted = slug === "index" ? "" : slug;
      if (pages.some((p) => p.slug === wanted)) onNavigate(wanted);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [pages, onNavigate]);

  if (!page) return <div className="empty">Nothing to preview yet.</div>;

  return (
    <div className={full ? "preview-shell is-full" : "preview-shell"}>
      <div className="preview-bar">
        <div className="seg seg-sm">
          {SIZES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={size === s.width ? "seg-btn is-on" : "seg-btn"}
              onClick={() => setSize(s.width)}
              title={s.width ? `${s.width} pixels wide` : "Fill the space available"}
            >
              {s.label}
            </button>
          ))}
        </div>
        {size ? <span className="preview-size">{size}px</span> : null}
      </div>

      <button
        type="button"
        className="preview-expand"
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

      {/* Scrolls rather than shrinks. A laptop width squeezed into a side
          pane would report the layout of a pane, which is the one answer this
          must never give. Full screen is where the wide ones are worth using. */}
      <div className={size ? "preview-stage is-sized" : "preview-stage"}>
        <iframe
          ref={frame}
          className="site-preview"
          title="Website preview"
          style={size ? { width: `${size}px`, flex: "0 0 auto" } : undefined}
          // Scripts, so the navigation works. No same-origin, so the frame is
          // its own origin and can reach nothing in the console.
          sandbox="allow-scripts"
          srcDoc={html}
        />
      </div>
    </div>
  );
}
