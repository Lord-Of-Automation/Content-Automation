/**
 * The parts of a website that are not any one page, and the design of all of it.
 *
 * A generated page is a body: no header, no navigation, no footer. That is
 * right for WordPress, where the theme supplies all three, and wrong for a
 * static site, which has to carry its own. So the shell lives here, once, and
 * is used twice — the console renders it to preview a site and the export
 * writes the same document to a file. One function means the preview cannot
 * drift from the thing it is previewing.
 *
 * It also carries a stylesheet, and that is the more important half. Markup on
 * its own is a wall of Times New Roman: technically a page, obviously not a
 * website. So there is a small design here, and a small vocabulary of classes
 * the writer is told to use — a lead paragraph, a card grid, a call to action,
 * a button. Anything the writer emits without them still reads properly,
 * because the plain elements are styled too and a site whose design only works
 * when the AI remembers a class name is a site that breaks silently.
 *
 * Every colour, the typeface and the width come from the site's own settings.
 * What is fixed is the arrangement and the restraint.
 *
 * No imports on purpose: this runs in the browser to draw a preview and on the
 * server to write files, and anything from node here would rule out the first.
 */

export interface ShellPage {
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  bodyHtml: string;
  order: number;
}

export interface ShellLink {
  label: string;
  url: string;
}

/**
 * A header and footer designed for this site, rather than the built-in one.
 *
 * Placeholders rather than real links. A model writing its own navigation gets
 * an address wrong eventually, marks the wrong page as current, or writes paths
 * into an export that is opened from a folder. So it writes the arrangement and
 * the styling, this fills in the links, and neither is trusted with the other's
 * job.
 */
export interface ShellDesign {
  headerHtml: string;
  footerHtml: string;
  css: string;
}

/** A site's palette, type and column width. */
export interface ShellTheme {
  accent: string;
  background: string;
  ink: string;
  font: "sans" | "serif";
  width: number;
}

export interface ShellSite {
  name: string;
  tagline: string;
  language: string;
  /** Absent on a site built before this existed, or when the step was skipped. */
  design?: ShellDesign | null;
  pages: ShellPage[];
  header: {
    logoUrl: string;
    showName: boolean;
    showTagline: boolean;
    showNav: boolean;
    links: ShellLink[];
  };
  footer: {
    text: string;
    links: ShellLink[];
    showCopyright: boolean;
  };
  theme: ShellTheme;
}

/** Text going into markup. Everything a person typed is text, not markup. */
export function escapeText(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Where a page lives, relative to the site root. */
export function addressOf(page: ShellPage): string {
  return page.slug ? `/${page.slug}` : "/";
}

/** The filename a static export writes it to. */
export function fileOf(page: ShellPage): string {
  return page.slug ? `${page.slug}.html` : "index.html";
}

const FONTS = {
  sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  serif: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
};

/**
 * The design.
 *
 * Three colours, a typeface and a width are chosen; everything else is worked
 * out from them. Muted text, borders and tints are mixed from the ink and the
 * background rather than being five more settings — nobody wants to choose five
 * greys, and one chosen badly is how a page ends up with unreadable captions.
 *
 * The class vocabulary at the bottom is what makes generated markup look like a
 * page rather than a document. It is deliberately short: a writer given thirty
 * class names uses none of them correctly.
 */
function styles(t: ShellTheme): string {
  return `
:root {
  --ink: ${t.ink};
  --bg: ${t.background};
  --accent: ${t.accent};
  --muted: color-mix(in srgb, var(--ink) 62%, transparent);
  --faint: color-mix(in srgb, var(--ink) 10%, transparent);
  --hair: color-mix(in srgb, var(--ink) 13%, transparent);
  --tint: color-mix(in srgb, var(--accent) 8%, var(--bg));
  --panel: color-mix(in srgb, var(--ink) 3%, var(--bg));
  --shadow: 0 1px 2px color-mix(in srgb, var(--ink) 6%, transparent),
            0 8px 28px color-mix(in srgb, var(--ink) 7%, transparent);
  --width: ${t.width}px;
  color-scheme: light;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: ${FONTS[t.font] ?? FONTS.sans};
  font-size: 17px;
  line-height: 1.7;
  color: var(--ink);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
.wrap { max-width: var(--width); margin: 0 auto; padding: 0 24px; }

/* ---------------------------------------------------------------- header */
header.site {
  position: sticky; top: 0; z-index: 20;
  background: color-mix(in srgb, var(--bg) 86%, transparent);
  backdrop-filter: saturate(180%) blur(14px);
  -webkit-backdrop-filter: saturate(180%) blur(14px);
  border-bottom: 1px solid var(--hair);
}
header.site .wrap {
  display: flex; align-items: center; gap: 26px;
  min-height: 68px; flex-wrap: wrap;
}
.brand { display: flex; align-items: center; gap: 11px; text-decoration: none; margin-right: auto; }
.brand-logo { max-height: 34px; width: auto; display: block; border-radius: 6px; }
.brand-name {
  font-size: 18px; font-weight: 680; letter-spacing: -0.02em;
  color: var(--ink); white-space: nowrap;
}
.brand-tagline {
  font-size: 13px; color: var(--muted); margin: 0;
  padding-left: 12px; border-left: 1px solid var(--hair);
}
nav.site { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
nav.site a {
  font-size: 15px; font-weight: 520; color: var(--muted);
  text-decoration: none; padding: 7px 12px; border-radius: 8px;
  transition: color .15s ease, background .15s ease;
}
nav.site a:hover { color: var(--ink); background: var(--panel); }
nav.site a.is-here { color: var(--ink); background: var(--tint); font-weight: 600; }

/* ------------------------------------------------------------------ type */
main.wrap { padding-top: 56px; padding-bottom: 24px; }
h1 {
  font-size: clamp(34px, 5.2vw, 50px);
  line-height: 1.08; letter-spacing: -0.033em;
  font-weight: 730; margin: 0 0 20px;
}
h2 {
  font-size: clamp(24px, 3vw, 30px);
  line-height: 1.22; letter-spacing: -0.02em;
  font-weight: 680; margin: 52px 0 14px;
}
h3 { font-size: 20px; line-height: 1.3; font-weight: 640; margin: 34px 0 10px; letter-spacing: -0.011em; }
h4 { font-size: 17px; font-weight: 640; margin: 26px 0 8px; }
p, ul, ol { margin: 0 0 19px; }
ul, ol { padding-left: 24px; }
li { margin-bottom: 8px; }
li::marker { color: var(--accent); }
a { color: var(--accent); text-underline-offset: 3px; text-decoration-thickness: 1px; }
a:hover { text-decoration-thickness: 2px; }
strong { font-weight: 650; }
hr { border: 0; height: 1px; background: var(--hair); margin: 44px 0; }
small { color: var(--muted); }


blockquote {
  margin: 0 0 22px; padding: 18px 22px;
  background: var(--panel); border-left: 3px solid var(--accent);
  border-radius: 0 10px 10px 0; color: var(--ink);
}
blockquote p:last-child { margin-bottom: 0; }

figure { margin: 0 0 22px; }
figcaption { font-size: 14px; color: var(--muted); margin-top: 8px; }

table { width: 100%; border-collapse: collapse; margin: 0 0 22px; font-size: 16px; }
th, td { padding: 12px 14px; border-bottom: 1px solid var(--hair); text-align: left; }
th { font-weight: 640; background: var(--panel); }
tr:last-child td { border-bottom: 0; }

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em; background: var(--panel);
  padding: 2px 6px; border-radius: 5px;
}
pre { background: var(--panel); padding: 16px 18px; border-radius: 10px; overflow-x: auto; }
pre code { background: none; padding: 0; }

/* ---------------------------------------------------------------- footer */
footer.site {
  margin-top: 84px; padding: 46px 0 30px;
  border-top: 1px solid var(--hair); background: var(--panel);
  font-size: 15px;
}
.footer-cols {
  display: grid; gap: 30px;
  grid-template-columns: minmax(220px, 1.6fr) repeat(auto-fit, minmax(150px, 1fr));
  margin-bottom: 34px;
}
.footer-about { color: var(--muted); margin: 0; max-width: 44ch; }
.footer-about strong { display: block; color: var(--ink); font-size: 17px; margin-bottom: 7px; }
footer.site nav { display: flex; flex-direction: column; gap: 9px; }
footer.site nav a {
  color: var(--muted); text-decoration: none; font-size: 15px;
  transition: color .15s ease;
}
footer.site nav a:hover { color: var(--ink); }
.footer-base {
  padding-top: 22px; border-top: 1px solid var(--hair);
  color: var(--muted); font-size: 14px;
  display: flex; gap: 14px; flex-wrap: wrap; justify-content: space-between;
}

/* A picture whose address is broken should look like a picture to fix, not
   like a gap somebody left in the page. */
img:not([src]), img[src=""] {
  min-height: 90px; background: var(--panel);
  border: 1px dashed var(--hair);
}

@media (max-width: 640px) {
  body { font-size: 16px; }
  main.wrap { padding-top: 36px; }
  .brand-tagline { display: none; }
  header.site .wrap { min-height: 60px; gap: 14px; }
}
`;
}

/**
 * The half a designed shell must not be able to reach.
 *
 * The page vocabulary and nothing else: .lead, .hero, .grid, .card, .btn, .cta
 * and the safety nets. Those belong to the pages, which were written
 * separately, and are not a header's to change.
 *
 * Everything else stays in the base, before the design, and that includes the
 * header and footer. A designed shell replaces both, so it has to be able to
 * override how they were styled. The first version of this split put the
 * footer here by accident, which meant the base footer overrode the designed
 * one and a design that drew a good footer got the old one's spacing and
 * background anyway.
 */
function guards(): string {
  return `
/* ------------------------------------------------------ the page vocabulary

   Emitted after any header design, so a header cannot restyle the pages. A
   designed shell is given the run of its own markup and none of this. */
/* The opening paragraph, whether or not it was labelled one. */
.lead, main.wrap > p:first-of-type {
  font-size: 20px; line-height: 1.6; color: var(--muted);
  margin-bottom: 26px;
}
/* -------------------------------------------------- the class vocabulary */

/* A block at the top of a page, set apart from what follows. */
.hero {
  padding: 8px 0 40px;
  border-bottom: 1px solid var(--hair);
  margin-bottom: 44px;
}
.hero p { font-size: 20px; color: var(--muted); max-width: 62ch; }

/* Anything in columns: features, services, a list of places. */
.grid {
  display: grid; gap: 20px;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  margin: 0 0 26px; padding: 0; list-style: none;
}
.grid > li { margin: 0; }

.card {
  padding: 24px; border: 1px solid var(--hair);
  border-radius: 14px; background: var(--panel);
  transition: box-shadow .18s ease, transform .18s ease;
}
.card:hover { box-shadow: var(--shadow); transform: translateY(-2px); }
.card h3 { margin-top: 0; }
.card > :last-child { margin-bottom: 0; }

/* A link that should read as a button. */
.btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 13px 24px; border-radius: 10px;
  background: var(--accent); color: var(--bg);
  font-weight: 600; font-size: 16px; text-decoration: none;
  transition: filter .15s ease, transform .15s ease;
}
.btn:hover { filter: brightness(1.08); transform: translateY(-1px); text-decoration: none; }
.btn-quiet {
  background: transparent; color: var(--ink);
  border: 1px solid var(--hair);
}
.btn-quiet:hover { background: var(--panel); filter: none; }

/* The block that asks for something, at the end of a page. */
.cta {
  margin: 48px 0 8px; padding: 34px;
  background: var(--tint); border: 1px solid var(--hair);
  border-radius: 16px; text-align: center;
}
.cta h2 { margin-top: 0; }
.cta p { color: var(--muted); max-width: 54ch; margin-left: auto; margin-right: auto; }
.cta > :last-child { margin-bottom: 0; }

/* The one responsive rule that belongs with the vocabulary rather than the
   base: it has to come after .cta itself or it loses on source order. */
@media (max-width: 640px) {
  .cta { padding: 26px 20px; }
}

/* -------------------------------------------------------------- last resort

   Nothing may push the page wider than the window. */
img, video, iframe, table, pre { max-width: 100%; }
img, video { height: auto; }

/*
 * An unsized icon, sized, and only where an icon belongs.
 *
 * An inline SVG carrying only a viewBox has no size of its own, so a browser
 * gives it the full width of whatever it sits in, and a small tick becomes a
 * full-width illustration. The first version of this rule sized every unsized
 * SVG on the page, which fixed the ticks and shrank the decorative shapes
 * behind the heroes to the size of a tick, which was worse.
 *
 * So: sized where icons live, which is with text, in a link, in a button or at
 * the top of a card. Anywhere else an unsized SVG is left able to fill its box,
 * because a shape behind a hero is meant to, and only capped so it cannot run
 * away with the page.
 *
 * Anything carrying its own width, height or class is untouched throughout.
 * Those are the three ways a thing says it meant to be another size.
 */
svg { vertical-align: middle; max-width: 100%; }
svg:not([width]):not([height]):not([class]) { max-height: 420px; }
:is(p, li, a, .btn, .card, h2, h3, h4, summary, td, th)
  svg:not([width]):not([height]):not([class]) {
  width: 1.5em;
  height: 1.5em;
  flex: none;
}
.btn svg:not([width]):not([height]):not([class]) { width: 1.15em; height: 1.15em; }
`;
}

/**
 * The script that makes navigation work inside a preview.
 *
 * Only added when asked for, and never in an exported file. A preview runs in
 * an iframe with scripts allowed but the same origin denied, so this can talk
 * to the console and reach nothing of it. A link that navigated the frame for
 * real would leave the preview showing a browser error about a page that does
 * not exist yet.
 */
const NAV_SCRIPT = `
document.addEventListener("click", function (e) {
  var a = e.target && e.target.closest ? e.target.closest("a") : null;
  if (!a) return;

  var href = a.getAttribute("href") || "";

  // An anchor within the page is the browser's own job and works here.
  if (href.charAt(0) === "#") return;

  // Nothing else may navigate this frame. It is a document with no address of
  // its own, so anything relative resolves against the console around it and
  // lands on a page that does not exist, which then asks you to sign in.
  e.preventDefault();
  parent.postMessage({ preview: "go", href: href }, "*");
});

// A form has the same problem and nowhere useful to go from here.
document.addEventListener("submit", function (e) { e.preventDefault(); });
`;

/**
 * The editor, living inside the preview.
 *
 * Editing used to happen in a bare box under the preview: the words in one
 * place, the site they belong to in another. Doing it in the page itself means
 * a heading is resized against the header above it and the section beside it,
 * which is the only context in which that decision makes sense.
 *
 * It has to be a script inside the frame because the frame is sandboxed
 * without same-origin access, so nothing outside can reach its document. That
 * is worth keeping: the page carries markup written by a model and may carry
 * its own script, and neither should be a keystroke away from the console's
 * session. So this runs in there, alone with the page, and talks to the panel
 * outside through messages. The panel never touches the document and the
 * document never reaches the console.
 *
 * Only <main> is editable. The header and footer are drawn from settings and
 * from the shell design, and letting somebody type into them here would put
 * changes somewhere nothing reads back.
 */
const EDIT_SCRIPT = `
(function () {
  var main = document.querySelector("main");
  if (!main) return;
  main.setAttribute("contenteditable", "true");
  main.style.outline = "none";

  var chosen = null;

  // Which properties the panel shows. Sent with every selection so it can
  // display what the element actually looks like rather than what was set.
  var WATCHED = [
    "fontSize", "fontWeight", "fontFamily", "color", "lineHeight",
    "letterSpacing", "textAlign", "width", "height", "maxWidth",
    "padding", "margin", "backgroundColor", "borderRadius", "border"
  ];

  function describe(el) {
    var tag = el.tagName.toLowerCase();
    var cls = (el.getAttribute("class") || "").trim().split(/\s+/)[0];
    return cls ? tag + "." + cls : tag;
  }

  function announce() {
    if (!chosen || !main.contains(chosen)) {
      parent.postMessage({ preview: "selected", element: null }, "*");
      return;
    }

    var computed = getComputedStyle(chosen);
    var styles = {};
    for (var i = 0; i < WATCHED.length; i++) {
      var key = WATCHED[i];
      styles[key] = chosen.style[key] || computed[key] || "";
    }

    var path = [];
    for (var node = chosen; node && node !== main; node = node.parentElement) {
      path.unshift(describe(node));
    }

    parent.postMessage({
      preview: "selected",
      element: {
        label: describe(chosen),
        path: path,
        isImage: chosen.tagName === "IMG",
        isLink: chosen.tagName === "A",
        src: chosen.getAttribute("src") || "",
        alt: chosen.getAttribute("alt") || "",
        href: chosen.getAttribute("href") || "",
        styles: styles
      }
    }, "*");
  }

  function pick(el) {
    if (chosen) chosen.removeAttribute("data-chosen");
    chosen = el && el !== main ? el : null;
    if (chosen) chosen.setAttribute("data-chosen", "");
    announce();
  }

  var timer = null;
  function report() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      var copy = main.cloneNode(true);
      var marked = copy.querySelectorAll("[data-chosen]");
      for (var i = 0; i < marked.length; i++) marked[i].removeAttribute("data-chosen");
      // The title is the renderer's, not the body's, so it is not part of
      // what this hands back. It travels on its own message instead.
      var h1 = copy.querySelector("h1[data-title]");
      if (h1) h1.remove();
      parent.postMessage({ preview: "html", html: copy.innerHTML }, "*");
    }, 300);
  }

  document.addEventListener("click", function (e) {
    // Nothing navigates while editing, including a link being selected.
    e.preventDefault();
    var el = e.target;
    while (el && el !== main && el.nodeType !== 1) el = el.parentElement;
    if (el && main.contains(el)) pick(el);
  }, true);

  document.addEventListener("selectionchange", function () {
    var sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var node = sel.anchorNode;
    if (!node || !main.contains(node)) return;
    var el = node.nodeType === 1 ? node : node.parentElement;
    if (el && el !== chosen && main.contains(el)) pick(el);
  });

  var titleEl = main.querySelector("h1[data-title]");
  var titleWas = titleEl ? titleEl.textContent : "";

  main.addEventListener("input", function () {
    // The heading at the top is the page's title, which the console keeps as a
    // field of its own. Typing into it here has to reach that field, or the
    // navigation and the meta title would go on saying the old one.
    if (titleEl && titleEl.textContent !== titleWas) {
      titleWas = titleEl.textContent;
      parent.postMessage({ preview: "title", text: titleWas }, "*");
    }
    report();
  });

  main.addEventListener("paste", function (e) {
    e.preventDefault();
    document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
  });

  window.addEventListener("message", function (e) {
    var m = e.data;
    if (!m || m.preview !== "edit") return;

    if (m.do === "style" && chosen) {
      chosen.style[m.key] = m.value;
    } else if (m.do === "attr" && chosen) {
      if (m.value) chosen.setAttribute(m.name, m.value);
      else chosen.removeAttribute(m.name);
    } else if (m.do === "exec") {
      main.focus();
      document.execCommand(m.command, false, m.argument);
    } else if (m.do === "delete" && chosen) {
      var going = chosen;
      pick(null);
      going.remove();
    } else if (m.do === "duplicate" && chosen) {
      var copy = chosen.cloneNode(true);
      copy.removeAttribute("data-chosen");
      chosen.after(copy);
    } else if (m.do === "up" && chosen && chosen.parentElement !== main) {
      pick(chosen.parentElement);
      return;
    } else if (m.do === "replace") {
      main.innerHTML = m.html;
      pick(null);
    }

    announce();
    report();
  });

  /*
   * How the selection looks, written in here because nothing outside the frame
   * can style what is inside it.
   *
   * An outline on an attribute rather than a floating overlay: an overlay has
   * to be repositioned on every scroll, resize and keystroke, and is wrong for
   * a moment each time.
   */
  var style = document.createElement("style");
  style.textContent =
    "[data-chosen]{outline:2px solid #2f6df6;outline-offset:1px}" +
    "main [contenteditable],main{cursor:text}";
  document.head.appendChild(style);

  parent.postMessage({ preview: "ready" }, "*");
})();
`;

/**
 * A page's own scripts, parsed but not run.
 *
 * The editor reads the page back out of the frame after every keystroke, which
 * means anything a script did to the page on the way in gets saved as if a
 * person had written it. A tab strip that hides all but the first panel, a
 * carousel that stamps positions onto its slides, a script that adds one class
 * on load: come back tomorrow and the page is frozen in whatever state that
 * left it, and the script is still there to do it again to the wreckage.
 *
 * So while editing they are given a type nothing executes. The browser still
 * parses them as raw text, so what comes back out is byte for byte what went
 * in, and the page is the markup that was written rather than the markup after
 * it ran. Preview mode runs them for real, which is where you want to see them.
 *
 * The original type is kept aside rather than dropped, because a module and a
 * plain script are not interchangeable and the page has to leave here as it
 * arrived.
 */
const INERT_TYPE = "text/x-not-while-editing";

export function inertScripts(html: string): string {
  return html.replace(/<script(\s[^>]*)?>/gi, (_all, attrs?: string) => {
    const kept = (attrs ?? "").replace(
      /\stype\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i,
      (_m, value: string) => ` data-type=${value}`,
    );
    return `<script${kept} type="${INERT_TYPE}">`;
  });
}

export function liveScripts(html: string): string {
  return html.replace(/<script(\s[^>]*)?>/gi, (all, attrs?: string) => {
    const had = attrs ?? "";
    if (!had.includes(INERT_TYPE)) return all;
    const kept = had
      .replace(/\stype\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i, "")
      .replace(
        /\sdata-type\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/i,
        (_m, value: string) => ` type=${value}`,
      );
    return `<script${kept}>`;
  });
}

export interface ShellOptions {
  /** Which page is being shown, so its nav entry can say so. */
  current: string;
  /** Whether links inside should tell the console to change page. */
  interactive?: boolean;
  /**
   * Whether the page can be edited in place.
   *
   * Replaces the navigation script rather than joining it: while editing,
   * clicking a link selects it instead of going anywhere.
   */
  editing?: boolean;
  /**
   * Addresses as files rather than paths.
   *
   * A static export is opened from a folder, where "/about" is not a file and
   * "/" is not a page. Links become about.html and index.html so the export
   * works when double-clicked, with no server involved.
   */
  asFiles?: boolean;
  /** The year on the copyright line. Passed in so rendering stays pure. */
  year?: number;
}

function linkTo(page: ShellPage, options: ShellOptions): string {
  return options.asFiles ? fileOf(page) : addressOf(page);
}

/**
 * One page, wrapped in the site it belongs to.
 *
 * The whole document, not a fragment: a preview that leaves out the doctype and
 * the head is a preview of something that is not the page.
 */
/**
 * Fill a designed header or footer in.
 *
 * Every placeholder is replaced whether or not it was used, so a design that
 * forgot one does not leave "{{NAV}}" on the page for a visitor to read.
 */
function fill(
  markup: string,
  site: ShellSite,
  options: ShellOptions,
  parts: { brand: string; nav: string; pages: string; links: string; copyright: string },
): string {
  return markup
    .replace(/\{\{\s*BRAND\s*\}\}/g, parts.brand)
    .replace(/\{\{\s*NAV\s*\}\}/g, parts.nav)
    .replace(/\{\{\s*PAGES\s*\}\}/g, parts.pages)
    .replace(/\{\{\s*LINKS\s*\}\}/g, parts.links)
    .replace(/\{\{\s*COPYRIGHT\s*\}\}/g, parts.copyright)
    .replace(/\{\{\s*NAME\s*\}\}/g, escapeText(site.name))
    // Empty when the header says not to show it, so a design cannot put back
    // what the setting just took away.
    .replace(
      /\{\{\s*TAGLINE\s*\}\}/g,
      site.header.showTagline ? escapeText(site.tagline) : "",
    )
    .replace(/\{\{\s*YEAR\s*\}\}/g, String(options.year ?? ""))
    // Anything else it invented. Better an empty space than a curly brace.
    .replace(/\{\{[^}]{0,40}\}\}/g, "");
}

/**
 * Everything that styles a page's own content, in the order it is applied.
 *
 * The look of a generated page is three stylesheets, not one. The base sets the
 * palette, the type and the width of the column the content sits in; the
 * design is what the build wrote for this particular site; the guards give the
 * page vocabulary — the cards, the grids, the buttons — shapes to fall back on.
 *
 * Anywhere a page is shown outside this renderer needs all three, or it gets a
 * site wearing a third of its own design and no idea which third. Exported so
 * that publishing sends the same stylesheet the preview draws, rather than
 * assembling a second opinion about what the site looks like.
 */
export function contentStyles(theme: ShellTheme, design: ShellDesign | null): string {
  return [styles(theme), design?.css ?? "", guards()].filter(Boolean).join("\n");
}

/**
 * The header and footer a site wears, without a document around them.
 *
 * Split out of the renderer so that anywhere else showing a page can show the
 * same chrome rather than growing its own idea of one. Publishing is the caller
 * that made this necessary: a page put on somebody's WordPress with the theme
 * stepped aside has no header at all unless it brings the site's own.
 *
 * Takes no page, because none of this ever depended on one. Which page is being
 * shown reaches it through `options.current`, and only to mark the link.
 */
export function renderChrome(
  site: ShellSite,
  options: ShellOptions,
): { header: string; footer: string } {
  const ordered = [...site.pages].sort((a, b) => a.order - b.order);
  const home = ordered[0];
  const h = site.header;
  const f = site.footer;
  const design = site.design;

  const pageLinks = ordered
    .map((p) => {
      const here = p.slug === options.current ? ' class="is-here"' : "";
      return `<a href="${escapeText(linkTo(p, options))}"${here}>${escapeText(p.title)}</a>`;
    })
    .join("\n          ");

  const extraLinks = h.links
    .map((l) => `<a href="${escapeText(l.url)}">${escapeText(l.label)}</a>`)
    .join("\n          ");

  /**
   * No menu for a site of one page.
   *
   * A navigation bar whose only entry is the page you are already on is not a
   * navigation bar, it is a label in the wrong place. Extra links still show,
   * because those go somewhere.
   */
  const worthNavigating = ordered.length > 1 || h.links.length > 0;

  const nav =
    h.showNav && worthNavigating && (pageLinks || extraLinks)
      ? `<nav class="site">
          ${[pageLinks, extraLinks].filter(Boolean).join("\n          ")}
        </nav>`
      : "";

  const brandInner = [
    h.logoUrl
      ? `<img class="brand-logo" src="${escapeText(h.logoUrl)}" alt="${escapeText(site.name)}">`
      : "",
    h.showName ? `<span class="brand-name">${escapeText(site.name)}</span>` : "",
  ]
    .filter(Boolean)
    .join("");

  const brand = brandInner
    ? `<a class="brand" href="${escapeText(home ? linkTo(home, options) : "/")}">
          ${brandInner}
          ${h.showTagline && site.tagline ? `<p class="brand-tagline">${escapeText(site.tagline)}</p>` : ""}
        </a>`
    : "";

  /**
   * The pieces a designed shell asks for by name.
   *
   * Built here whether or not one is in use, because the built-in header wants
   * the same links and building them twice is how the two drift apart.
   */
  const parts = {
    /**
     * The header settings govern a designed shell too.
     *
     * They used to govern only the built-in header, so the moment a site had a
     * designed one — which every new site does — Show the tagline and Show
     * navigation did nothing at all. The design decides the arrangement; these
     * decide what goes in it, and a design cannot be allowed to overrule them
     * by filling a placeholder the setting said to leave empty.
     */
    brand: h.logoUrl
      ? `<img class="brand-logo" src="${escapeText(h.logoUrl)}" alt="${escapeText(site.name)}">`
      : h.showName
        ? `<span class="brand-name">${escapeText(site.name)}</span>`
        : "",
    nav: h.showNav ? pageLinks : "",
    pages: ordered
      .map((p) => `<a href="${escapeText(linkTo(p, options))}">${escapeText(p.title)}</a>`)
      .join(""),
    links: h.showNav
      ? h.links.map((l) => `<a href="${escapeText(l.url)}">${escapeText(l.label)}</a>`).join("")
      : "",
    copyright: f.showCopyright
      ? `&copy; ${options.year ?? ""} ${escapeText(site.name)}`
      : "",
  };

  const header = design?.headerHtml
    ? `  <header class="site">
${fill(design.headerHtml, site, options, parts)}
    </header>`
    : brand || nav
      ? `  <header class="site">
      <div class="wrap">
        ${brand}
        ${nav}
      </div>
    </header>`
      : "";

  const about =
    f.text || site.name
      ? `<p class="footer-about">${
          f.showCopyright || site.name ? `<strong>${escapeText(site.name)}</strong>` : ""
        }${f.text
          .split(/\n+/)
          .map((l) => escapeText(l))
          .join("<br>")}</p>`
      : "";

  const footerNav = f.links.length
    ? `<nav>${f.links
        .map((l) => `<a href="${escapeText(l.url)}">${escapeText(l.label)}</a>`)
        .join("")}</nav>`
    : "";

  const pageNav =
    ordered.length > 1
      ? `<nav>${ordered
          .map((p) => `<a href="${escapeText(linkTo(p, options))}">${escapeText(p.title)}</a>`)
          .join("")}</nav>`
      : "";

  const base = f.showCopyright
    ? `<div class="footer-base"><span>&copy; ${options.year ?? ""} ${escapeText(site.name)}</span></div>`
    : "";

  const footer = design?.footerHtml
    ? `  <footer class="site">
${fill(design.footerHtml, site, options, parts)}
    </footer>`
    : about || footerNav || pageNav || base
      ? `  <footer class="site">
      <div class="wrap">
        <div class="footer-cols">
          ${about}
          ${pageNav}
          ${footerNav}
        </div>
        ${base}
      </div>
    </footer>`
      : "";

  return { header, footer };
}

export function renderPage(site: ShellSite, page: ShellPage, options: ShellOptions): string {
  const design = site.design;
  const { header, footer } = renderChrome(site, options);

  const title = page.metaTitle || `${page.title} — ${site.name}`;

  return `<!doctype html>
<html lang="${escapeText(site.language || "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(title)}</title>
${page.metaDescription ? `<meta name="description" content="${escapeText(page.metaDescription)}">` : ""}
<style>${styles(site.theme)}</style>
${design?.css ? `<style>${design.css}</style>` : ""}
<style>${guards()}</style>
</head>
<body>
${header}
  <main class="wrap">
    <h1 data-title>${escapeText(page.title)}</h1>
    ${options.editing ? inertScripts(page.bodyHtml) : page.bodyHtml}
  </main>
${footer}
${options.editing ? `<script>${EDIT_SCRIPT}</script>` : options.interactive ? `<script>${NAV_SCRIPT}</script>` : ""}
</body>
</html>`;
}
