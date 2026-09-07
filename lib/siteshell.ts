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
  theme: {
    accent: string;
    background: string;
    ink: string;
    font: "sans" | "serif";
    width: number;
  };
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
function styles(site: ShellSite): string {
  const t = site.theme;
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

`;
}

/**
 * The half a designed header must not be able to reach.
 *
 * Emitted after the shell's own CSS, so a header design can style its own
 * markup and the header and footer it replaces, and cannot reach .btn, .card,
 * .grid, .hero, .cta or .lead. Those belong to the pages, which were written
 * separately and are not its to change.
 *
 * This was one stylesheet, all of it before the design, which meant a header
 * that wrote a broad selector restyled every page on the site.
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
  var a = e.target.closest ? e.target.closest("a") : null;
  if (!a) return;
  var href = a.getAttribute("href") || "";
  if (href.charAt(0) !== "/") return;
  e.preventDefault();
  parent.postMessage({ preview: "go", slug: href.slice(1) }, "*");
});
`;

export interface ShellOptions {
  /** Which page is being shown, so its nav entry can say so. */
  current: string;
  /** Whether links inside should tell the console to change page. */
  interactive?: boolean;
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
    .replace(/\{\{\s*TAGLINE\s*\}\}/g, escapeText(site.tagline))
    .replace(/\{\{\s*YEAR\s*\}\}/g, String(options.year ?? ""))
    // Anything else it invented. Better an empty space than a curly brace.
    .replace(/\{\{[^}]{0,40}\}\}/g, "");
}

export function renderPage(site: ShellSite, page: ShellPage, options: ShellOptions): string {
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

  const nav =
    h.showNav && (pageLinks || extraLinks)
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
    brand: brand || `<span class="brand-name">${escapeText(site.name)}</span>`,
    nav: pageLinks,
    pages: ordered
      .map((p) => `<a href="${escapeText(linkTo(p, options))}">${escapeText(p.title)}</a>`)
      .join(""),
    links: h.links
      .map((l) => `<a href="${escapeText(l.url)}">${escapeText(l.label)}</a>`)
      .join(""),
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

  const title = page.metaTitle || `${page.title} — ${site.name}`;

  return `<!doctype html>
<html lang="${escapeText(site.language || "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(title)}</title>
${page.metaDescription ? `<meta name="description" content="${escapeText(page.metaDescription)}">` : ""}
<style>${styles(site)}</style>
${design?.css ? `<style>${design.css}</style>` : ""}
<style>${guards()}</style>
</head>
<body>
${header}
  <main class="wrap">
    <h1>${escapeText(page.title)}</h1>
    ${page.bodyHtml}
  </main>
${footer}
${options.interactive ? `<script>${NAV_SCRIPT}</script>` : ""}
</body>
</html>`;
}
