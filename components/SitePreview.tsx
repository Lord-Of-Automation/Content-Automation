"use client";

import { useEffect, useMemo, useRef } from "react";

import { renderPage, type ShellPage, type ShellSite } from "@/lib/siteshell";

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
 * The document it renders is the same one static hosting will write to a file.
 * A preview built beside an exporter drifts from it; a preview that calls the
 * exporter cannot.
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
      const data = event.data as { preview?: string; slug?: string } | null;
      if (!data || data.preview !== "go") return;

      const slug = String(data.slug ?? "");
      if (pages.some((p) => p.slug === slug)) onNavigate(slug);
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [pages, onNavigate]);

  if (!page) return <div className="empty">Nothing to preview yet.</div>;

  return (
    <iframe
      ref={frame}
      className="site-preview"
      title="Website preview"
      // Scripts, so the navigation works. No same-origin, so the frame is its
      // own origin and can reach nothing in the console.
      sandbox="allow-scripts"
      srcDoc={html}
    />
  );
}
