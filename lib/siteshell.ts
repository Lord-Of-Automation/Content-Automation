/**
 * The parts of a website that are not any one page.
 *
 * A generated page is a body and nothing else: no header, no navigation, no
 * footer. That is right for WordPress, where the theme supplies all three and
 * writing them again would put two of each on the page. It is not right for a
 * static site, which has to carry its own, and it left nothing anywhere able to
 * answer "what does this site look like".
 *
 * So the shell lives here, once, and is used twice. The console renders it to
 * preview a site, and the static export writes the same document to a file. One
 * function means the preview cannot drift from the thing it is previewing,
 * which is the usual fate of a preview built beside an exporter.
 *
 * What is arranged here and what is decided elsewhere is a deliberate split.
 * This owns the arrangement: a header above, navigation under it, the page,
 * then a footer. Every choice inside that — the colours, the width, whether the
 * tagline shows at all — is data on the website, because "change the footer" is
 * the second thing anybody wants after "change the words" and neither should
 * mean editing markup.
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

export interface ShellSite {
  name: string;
  tagline: string;
  language: string;
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
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  serif: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
};

/**
 * A plain, readable look, built from the site's own settings.
 *
 * Deliberately modest whatever the settings. This shows writing rather than
 * design, and a strong theme flatters copy and hides the thing being judged. It
 * is also the starting point for a static export, where something legible
 * nobody has to fix beats something fashionable they do.
 *
 * Muted greys are derived from the ink colour rather than being settings of
 * their own. Nobody wants to choose five greys, and one chosen badly is how a
 * page ends up with unreadable captions.
 */
function styles(site: ShellSite): string {
  const t = site.theme;
  return `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font: 16px/1.65 ${FONTS[t.font] ?? FONTS.sans};
  color: ${t.ink};
  background: ${t.background};
}
a { color: ${t.accent}; }
.wrap { max-width: ${t.width}px; margin: 0 auto; padding: 0 22px; }
header.site { border-bottom: 1px solid rgba(0,0,0,0.09); padding: 22px 0; margin-bottom: 34px; }
.site-logo { max-height: 46px; width: auto; display: block; }
.site-name { font-size: 20px; font-weight: 650; color: ${t.ink}; text-decoration: none; }
.site-tagline { margin: 3px 0 0; opacity: 0.65; font-size: 14px; }
nav.site { margin-top: 14px; display: flex; flex-wrap: wrap; gap: 16px; }
nav.site a { font-size: 14.5px; font-weight: 550; text-decoration: none; }
nav.site a.is-here { color: ${t.ink}; text-decoration: underline; }
h1 { font-size: 32px; line-height: 1.22; margin: 0 0 18px; }
h2 { font-size: 22px; line-height: 1.3; margin: 30px 0 10px; }
h3 { font-size: 18px; margin: 22px 0 8px; }
p, ul, ol { margin: 0 0 15px; }
ul, ol { padding-left: 22px; }
li { margin-bottom: 6px; }
img { max-width: 100%; height: auto; border-radius: 8px; }
blockquote { margin: 0 0 15px; padding-left: 15px; border-left: 3px solid ${t.accent}; opacity: 0.85; }
table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
th, td { padding: 8px 10px; border: 1px solid rgba(0,0,0,0.12); text-align: left; }
footer.site { margin-top: 52px; padding: 22px 0; border-top: 1px solid rgba(0,0,0,0.09); opacity: 0.72; font-size: 14px; }
footer.site nav { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 8px; }
/* A picture whose address is broken should look like a picture to fix, not
   like a gap somebody left in the page. */
img:not([src]), img[src=""] {
  display: block; min-height: 70px;
  background: rgba(0,0,0,0.05); border: 1px dashed rgba(0,0,0,0.2);
}
@media (max-width: 640px) { h1 { font-size: 26px; } }
`;
}

/**
 * The script that makes navigation work inside a preview.
 *
 * Only added when asked for, and never in an exported file. A preview runs in
 * an iframe with scripts allowed but the same origin denied, so this can talk to
 * the console and reach nothing of it. A link that navigated the frame for real
 * would leave the preview showing a browser error about a page that does not
 * exist yet.
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
export function renderPage(site: ShellSite, page: ShellPage, options: ShellOptions): string {
  const ordered = [...site.pages].sort((a, b) => a.order - b.order);
  const home = ordered[0];
  const h = site.header;
  const f = site.footer;

  const pageLinks = ordered
    .map((p) => {
      const here = p.slug === options.current ? ' class="is-here"' : "";
      return `<a href="${escapeText(linkTo(p, options))}"${here}>${escapeText(p.title)}</a>`;
    })
    .join("\n        ");

  const extraLinks = h.links
    .map((l) => `<a href="${escapeText(l.url)}">${escapeText(l.label)}</a>`)
    .join("\n        ");

  const nav =
    h.showNav && (pageLinks || extraLinks)
      ? `<nav class="site">
        ${[pageLinks, extraLinks].filter(Boolean).join("\n        ")}
      </nav>`
      : "";

  const brand = h.logoUrl
    ? `<img class="site-logo" src="${escapeText(h.logoUrl)}" alt="${escapeText(site.name)}">`
    : h.showName
      ? `<span class="site-name">${escapeText(site.name)}</span>`
      : "";

  const header =
    brand || nav || (h.showTagline && site.tagline)
      ? `  <header class="site">
    <div class="wrap">
      ${brand ? `<a href="${escapeText(home ? linkTo(home, options) : "/")}" style="text-decoration:none">${brand}</a>` : ""}
      ${h.showTagline && site.tagline ? `<p class="site-tagline">${escapeText(site.tagline)}</p>` : ""}
      ${nav}
    </div>
  </header>`
      : "";

  const footerLinks = f.links.length
    ? `<nav>${f.links
        .map((l) => `<a href="${escapeText(l.url)}">${escapeText(l.label)}</a>`)
        .join("")}</nav>`
    : "";

  const copyright = f.showCopyright
    ? `<div>&copy; ${options.year ?? ""} ${escapeText(site.name)}</div>`
    : "";

  const footerText = f.text
    ? `<div>${f.text
        .split(/\n+/)
        .map((l) => escapeText(l))
        .join("<br>")}</div>`
    : "";

  const footer =
    footerLinks || copyright || footerText
      ? `  <footer class="site">
    <div class="wrap">
      ${footerLinks}
      ${footerText}
      ${copyright}
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
