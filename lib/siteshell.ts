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
 * preview a site, and static hosting will render the same thing to a file. One
 * function means the preview cannot drift from the thing it is previewing —
 * which is the usual fate of a preview built beside an exporter.
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

export interface ShellSite {
  name: string;
  tagline: string;
  language: string;
  pages: ShellPage[];
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

/**
 * A plain, readable default look.
 *
 * Deliberately modest. This is a preview of writing rather than a design, and a
 * strong theme here would flatter the copy and hide the thing you are trying to
 * judge. It is also the starting point for a static export, where something
 * legible that nobody has to fix beats something fashionable that they do.
 */
const STYLES = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  margin: 0;
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  color: #1b2430;
  background: #fff;
}
a { color: #2f6df6; }
.wrap { max-width: 760px; margin: 0 auto; padding: 0 22px; }
header.site {
  border-bottom: 1px solid #e6e9ee;
  padding: 22px 0;
  margin-bottom: 34px;
}
.site-name {
  font-size: 20px;
  font-weight: 650;
  color: #10141a;
  text-decoration: none;
}
.site-tagline { margin: 3px 0 0; color: #6d7887; font-size: 14px; }
nav.site { margin-top: 14px; display: flex; flex-wrap: wrap; gap: 16px; }
nav.site a { font-size: 14.5px; font-weight: 550; text-decoration: none; }
nav.site a.is-here { color: #10141a; text-decoration: underline; }
h1 { font-size: 32px; line-height: 1.22; margin: 0 0 18px; }
h2 { font-size: 22px; line-height: 1.3; margin: 30px 0 10px; }
h3 { font-size: 18px; margin: 22px 0 8px; }
p, ul, ol { margin: 0 0 15px; }
ul, ol { padding-left: 22px; }
li { margin-bottom: 6px; }
img { max-width: 100%; height: auto; border-radius: 8px; }
blockquote {
  margin: 0 0 15px; padding-left: 15px;
  border-left: 3px solid #e6e9ee; color: #4a5567;
}
table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
th, td { padding: 8px 10px; border: 1px solid #e6e9ee; text-align: left; }
footer.site {
  margin-top: 52px; padding: 22px 0;
  border-top: 1px solid #e6e9ee;
  color: #6d7887; font-size: 14px;
}
/* A picture whose address is broken should look like a picture to fix, not
   like a gap somebody left in the page. */
img:not([src]), img[src=""] {
  display: block; min-height: 70px;
  background: #f2f4f7; border: 1px dashed #d3d9e2;
}
`;

/**
 * The script that makes navigation work inside a preview.
 *
 * Only added when asked for. A preview runs in an iframe with scripts allowed
 * but the same origin denied, so this can talk to the console and can reach
 * nothing of it — and a link that navigated the frame for real would leave the
 * preview showing a browser error about a page that does not exist yet.
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

  const nav = ordered
    .map((p) => {
      const here = p.slug === options.current ? ' class="is-here"' : "";
      return `<a href="${escapeText(addressOf(p))}"${here}>${escapeText(p.title)}</a>`;
    })
    .join("\n        ");

  const title = page.metaTitle || `${page.title} — ${site.name}`;
  const year = "";

  return `<!doctype html>
<html lang="${escapeText(site.language || "en")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeText(title)}</title>
${page.metaDescription ? `<meta name="description" content="${escapeText(page.metaDescription)}">` : ""}
<style>${STYLES}</style>
</head>
<body>
  <header class="site">
    <div class="wrap">
      <a class="site-name" href="${escapeText(home ? addressOf(home) : "/")}">${escapeText(site.name)}</a>
      ${site.tagline ? `<p class="site-tagline">${escapeText(site.tagline)}</p>` : ""}
      <nav class="site">
        ${nav}
      </nav>
    </div>
  </header>

  <main class="wrap">
    <h1>${escapeText(page.title)}</h1>
    ${page.bodyHtml}
  </main>

  <footer class="site">
    <div class="wrap">${escapeText(site.name)}${year}</div>
  </footer>
${options.interactive ? `<script>${NAV_SCRIPT}</script>` : ""}
</body>
</html>`;
}
