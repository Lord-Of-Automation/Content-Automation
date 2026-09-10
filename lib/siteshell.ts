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
.wrap.is-page { padding-top: 56px; padding-bottom: 24px; }
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
  .wrap.is-page { padding-top: 36px; }
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
.lead, .wrap.is-page > p:first-of-type {
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
/*
 * Escape, sent outward.
 *
 * The console listens for it too, but a key pressed inside this frame never
 * reaches the page around it — and full screen is precisely the state in which
 * the cursor is in here. So the frame says so, and the console decides what
 * leaving means.
 */
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") parent.postMessage({ preview: "escape" }, "*");
});
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

  /*
   * Styling one width at a time.
   *
   * The panel can preview the page at a phone's width, and until now every
   * style set while looking at it applied at every width — so a heading sized
   * to look right on a laptop was sized wrong on a phone, with no way to say
   * otherwise. A page builder that shows you three widths and only lets you
   * style one of them is showing you a problem it cannot solve.
   *
   * A style for a narrower width cannot be an inline attribute, because an
   * inline style has no width to be conditional on. So it becomes a rule, and
   * the rule needs a name for the element it applies to, which is what the
   * marker is.
   *
   * The rules live in a stylesheet inside <main>, which means they are part of
   * the body markup and are saved, exported and published with it like anything
   * else on the page. Nothing new has to learn about them.
   *
   * They are marked important because the base style they override is inline,
   * and an attribute selector loses to an inline style however specific it is.
   * A narrower width is a deliberate exception and should win.
   */
  var media = 0;
  var marks = 0;

  var MARK = /^\\[data-r="[a-z0-9]+"\\]$/;

  (function () {
    // A page edited before, reopened. The counter carries on from the highest
    // marker already on it rather than from nothing, or the next element
    // styled would take a name another one is already answering to.
    var already = main.querySelectorAll("[data-r]");
    for (var i = 0; i < already.length; i++) {
      var n = Number(String(already[i].getAttribute("data-r")).replace(/[^0-9]/g, ""));
      if (n > marks) marks = n;
    }
  })();

  function markerFor(el) {
    var had = el.getAttribute("data-r");
    if (had) return had;
    marks += 1;
    var name = "r" + marks;
    el.setAttribute("data-r", name);
    return name;
  }

  /** The stylesheet the editor keeps inside the page, so it travels with it. */
  function holder() {
    var el = main.querySelector("style[data-editor-css]");
    if (!el) {
      el = document.createElement("style");
      el.setAttribute("data-editor-css", "");
      main.insertBefore(el, main.firstChild);
    }
    return el;
  }

  function camel(name) {
    return name.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); });
  }

  function dashed(name) {
    return name.replace(/[A-Z]/g, function (c) { return "-" + c.toLowerCase(); });
  }

  /*
   * What is in that stylesheet, as something this can change.
   *
   * Read through the browser's own parser rather than by matching text, so
   * whatever shape it was left in last time is understood. Anything this did
   * not write is kept whole and put back untouched: the markup is the person's,
   * and a hand-written rule in there must survive an unrelated edit.
   */
  var rules = {};
  var raw = [];

  function isOurs(rule) {
    return !!rule && rule.type === 1 && MARK.test(String(rule.selectorText || "").trim());
  }

  /*
   * The properties the panel offers as one box, and the ones they stand for.
   *
   * Padding is written as "padding:8px" and read back by the browser as four
   * separate numbers, because that is what padding is. The panel has one box
   * for it, so after a reopen that box found nothing under the name it knows
   * and drew itself empty — a padding that was set, showing as unset, and
   * cleared by anybody who then typed in it.
   *
   * Border's parts are listed rather than matched by their prefix on purpose.
   * Corner radius begins with the same word and is a control of its own, and a
   * prefix test would quietly swallow it.
   */
  var SHORTHAND = [
    ["padding", ["padding-top", "padding-right", "padding-bottom", "padding-left"]],
    ["margin", ["margin-top", "margin-right", "margin-bottom", "margin-left"]],
    ["border", [
      "border-top-width", "border-right-width", "border-bottom-width", "border-left-width",
      "border-top-style", "border-right-style", "border-bottom-style", "border-left-style",
      "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
      "border-width", "border-style", "border-color",
      "border-image-source", "border-image-slice", "border-image-width",
      "border-image-outset", "border-image-repeat"
    ]]
  ];

  function absorb(px, rule) {
    var name = String(rule.selectorText).trim().slice(9, -2);
    var bag = rules[px] || (rules[px] = {});
    var one = bag[name] || (bag[name] = {});

    for (var i = 0; i < rule.style.length; i++) {
      one[camel(rule.style[i])] = rule.style.getPropertyValue(rule.style[i]);
    }

    for (var s = 0; s < SHORTHAND.length; s++) {
      var short = SHORTHAND[s][0];
      var whole = rule.style.getPropertyValue(short);
      if (!whole) continue;
      var parts = SHORTHAND[s][1];
      for (var p = 0; p < parts.length; p++) delete one[camel(parts[p])];
      one[camel(short)] = whole;
    }
  }

  function readRules() {
    rules = {};
    raw = [];

    // Never creates one. Reading is not a reason to leave an empty stylesheet
    // in somebody's markup, and a selection reads.
    var el = main.querySelector("style[data-editor-css]");
    var sheet = null;
    try {
      sheet = el ? el.sheet : null;
    } catch (e) {
      sheet = null;
    }
    if (!sheet) return;

    for (var i = 0; i < sheet.cssRules.length; i++) {
      var rule = sheet.cssRules[i];

      if (rule.type === 4) {
        var px = Number(String(rule.conditionText || rule.media.mediaText || "")
          .replace(/[^0-9]/g, ""));
        var ours = px > 0 && rule.cssRules.length > 0;
        for (var j = 0; ours && j < rule.cssRules.length; j++) {
          if (!isOurs(rule.cssRules[j])) ours = false;
        }
        if (!ours) { raw.push(rule.cssText); continue; }
        for (var k = 0; k < rule.cssRules.length; k++) absorb(px, rule.cssRules[k]);
      } else if (isOurs(rule)) {
        absorb(0, rule);
      } else {
        raw.push(rule.cssText);
      }
    }
  }

  function declText(one, important) {
    var parts = [];
    for (var key in one) {
      if (one[key]) parts.push(dashed(key) + ":" + one[key] + (important ? "!important" : ""));
    }
    return parts.join(";");
  }

  function writeRules() {
    var out = raw.slice();

    var base = rules[0];
    for (var name in base) {
      var flat = declText(base[name], false);
      if (flat) out.push('[data-r="' + name + '"]{' + flat + '}');
    }

    // Narrowest last, so a phone rule wins over a tablet one that also matches.
    var widths = [];
    for (var px in rules) if (Number(px) > 0) widths.push(Number(px));
    widths.sort(function (a, b) { return b - a; });

    for (var w = 0; w < widths.length; w++) {
      var inner = [];
      var bag = rules[widths[w]];
      for (var one in bag) {
        var text = declText(bag[one], true);
        if (text) inner.push('[data-r="' + one + '"]{' + text + '}');
      }
      if (inner.length) {
        out.push("@media (max-width:" + widths[w] + "px){" + inner.join("") + "}");
      }
    }

    var el = holder();
    // An empty stylesheet is removed rather than left as a blank tag in the
    // markup: undoing every width-specific style should leave the page as it
    // would have been if none had ever been set.
    if (out.length) el.textContent = out.join("\\n");
    else el.remove();
  }

  function styleAt(el, key, value) {
    readRules();
    var name = markerFor(el);
    var bag = rules[media] || (rules[media] = {});
    var one = bag[name] || (bag[name] = {});

    if (value) one[key] = value;
    else delete one[key];

    var anything = false;
    for (var k in one) { anything = true; break; }
    if (!anything) delete bag[name];

    writeRules();
  }

  /** What this element is set to at the width being edited, and nothing else. */
  function setAtWidth(el) {
    var out = {};
    if (!media || !el) return out;
    var name = el.getAttribute("data-r");
    if (!name) return out;
    readRules();
    var bag = rules[media];
    var one = bag ? bag[name] : null;
    for (var key in one) out[key] = one[key];
    return out;
  }

  /** The block of the page this lives in, which is what gets moved and copied. */
  function topOf(el) {
    var node = el;
    while (node && node.parentElement && node.parentElement !== main) {
      node = node.parentElement;
    }
    return node && node.parentElement === main ? node : null;
  }

  /*
   * A selector for something in the header or footer.
   *
   * The chrome is not markup that gets saved — it is a template rendered afresh
   * every time — so a style set on it has to be recorded as a rule against a
   * name for the thing, and the name has to still mean the same thing after the
   * next render.
   *
   * Classes first, since a designed shell names its parts and those names are
   * the most durable thing about it. Position only where there is nothing else
   * to go on, and only as far up as the header or footer, so a rule cannot
   * escape into the page.
   */
  function selectorFor(el) {
    var root = el.closest("header.site,footer.site");
    if (!root) return "";

    var parts = [];
    for (var node = el; node && node !== root; node = node.parentElement) {
      // A wrapper that only exists while editing cannot be part of a name for
      // something that has to be found again once it is gone.
      if (node.matches && node.matches(WRAPPERS)) continue;

      var tag = node.tagName.toLowerCase();
      var cls = (node.getAttribute("class") || "")
        .split(/\\s+/)
        .filter(function (c) { return c && !/^is-/.test(c); })
        .slice(0, 2)
        .map(function (c) { return "." + c; })
        .join("");

      var step = cls || tag;
      if (!cls) {
        var siblings = node.parentElement ? node.parentElement.children : [];
        var same = 0;
        var mine = 0;
        for (var i = 0; i < siblings.length; i++) {
          if (siblings[i].tagName === node.tagName) {
            same += 1;
            if (siblings[i] === node) mine = same;
          }
        }
        if (same > 1) step += ":nth-of-type(" + mine + ")";
      }
      parts.unshift(step);
    }

    var base = root.tagName.toLowerCase() + ".site";
    var selector = parts.length ? base + " " + parts.join(" > ") : base;

    // Only worth using if it means one thing. If it does not, fall back to the
    // whole chain, which always does.
    try {
      if (document.querySelectorAll(selector).length === 1) return selector;
    } catch (e) {
      return "";
    }
    return selector;
  }

  function describe(el) {
    var tag = el.tagName.toLowerCase();
    var cls = (el.getAttribute("class") || "").trim().split(/\\s+/)[0];
    return cls ? tag + "." + cls : tag;
  }

  function announce() {
    /*
     * Anything selected is described, wherever it lives.
     *
     * This used to describe only what was inside the page, and everything else
     * as nothing — so a heading in the header could be selected, could be
     * styled, and the panel that does the styling showed an empty box. The
     * difference between the page and the chrome is in where a change is
     * written down, not in whether it can be looked at.
     */
    if (!chosen || !document.body.contains(chosen)) {
      parent.postMessage({ preview: "selected", element: null }, "*");
      outline();
      return;
    }

    var computed = getComputedStyle(chosen);
    var styles = {};
    for (var i = 0; i < WATCHED.length; i++) {
      var key = WATCHED[i];
      styles[key] = chosen.style[key] || computed[key] || "";
    }

    var top = main.contains(chosen) ? main : chosen.closest("header.site,footer.site");
    /*
     * What is behind it, when it has nothing of its own.
     *
     * Most elements have no background: the computed value is a transparent
     * black, which a colour swatch has no way to draw except as black. So the
     * panel showed a black square on a white card, which reads as a background
     * that is set and wrong rather than one that was never set at all.
     *
     * The colour actually showing through is found by looking behind, and the
     * panel draws that instead — and says the element has none of its own.
     */
    var backdrop = computed.backgroundColor;
    var clear = !backdrop || backdrop === "transparent" ||
      /^rgba\\(.*,\\s*0\\)$/.test(backdrop);
    if (clear) {
      for (var behind = chosen.parentElement; behind; behind = behind.parentElement) {
        var c = getComputedStyle(behind).backgroundColor;
        if (c && c !== "transparent" && !/^rgba\\(.*,\\s*0\\)$/.test(c)) {
          backdrop = c;
          break;
        }
      }
    }

    var path = [];
    for (var node = chosen; node && node !== top; node = node.parentElement) {
      path.unshift(describe(node));
    }

    /*
     * What it says and what it is made of, for the assistant beside the page.
     *
     * "Rewrite this paragraph" is the most natural thing to ask about something
     * you have just clicked on, and the panel that takes that request had no
     * idea anything was selected. Both are capped: this travels on every
     * selection, and a whole section of markup on every click is a cost for a
     * feature most clicks are not using.
     */
    var words = (chosen.textContent || "").trim().replace(/\\s+/g, " ");

    parent.postMessage({
      preview: "selected",
      element: {
        label: describe(chosen),
        path: path,
        where: main.contains(chosen) ? "page" : "chrome",
        backdrop: backdrop,
        ownBackground: !clear,
        isImage: chosen.tagName === "IMG",
        isLink: chosen.tagName === "A",
        src: chosen.getAttribute("src") || "",
        alt: chosen.getAttribute("alt") || "",
        href: chosen.getAttribute("href") || "",
        styles: styles,
        atWidth: setAtWidth(chosen),
        text: words.slice(0, 600),
        html: chosen.outerHTML.slice(0, 4000)
      }
    }, "*");

    outline();
  }

  /*
   * The page as a list of what it is made of.
   *
   * The breadcrumbs only walk upward, so on a long page there was no way to see
   * the sections or move between them without scrolling and aiming. This is the
   * same page from the side.
   *
   * Only the top level. A tree of everything is a tree nobody reads, and the
   * things people move, copy and delete are blocks rather than the spans inside
   * them.
   */
  function outline() {
    var rows = [];
    for (var i = 0; i < main.children.length; i++) {
      var el = main.children[i];
      if (el.tagName === "STYLE" || el.tagName === "SCRIPT") continue;

      var head = /^H[1-6]$/.test(el.tagName) ? el : el.querySelector("h1,h2,h3,h4,h5,h6");
      var words = ((head ? head.textContent : el.textContent) || "")
        .trim().replace(/\\s+/g, " ");

      rows.push({
        at: i,
        label: describe(el),
        heading: head ? head.tagName.toLowerCase() : "",
        text: words.slice(0, 80),
        here: !!chosen && (el === chosen || el.contains(chosen))
      });
    }
    parent.postMessage({ preview: "outline", rows: rows }, "*");
  }

  /*
   * Some of what is on screen while editing is not on screen otherwise.
   *
   * Some settings are made editable by wrapping their text in a span that
   * exists only while editing. Selecting one of those and styling it writes a
   * rule ending in that span, and the span is not there on the published page,
   * so the rule matches nothing and the change appears to have been ignored.
   *
   * So a wrapper stands for the thing it wraps. The wrappers say so
   * themselves rather than being recognised by what they are for: the same
   * marker sits on a span invented here and on a heading that was already
   * there, depending on whether the shell is designed or built in, and only one
   * of the two should be stepped over.
   */
  var WRAPPERS = "[data-editor-wrap]";

  function real(el) {
    if (!el || !el.matches) return el;
    return el.matches(WRAPPERS) && el.parentElement ? el.parentElement : el;
  }

  function pick(el) {
    if (chosen) chosen.removeAttribute("data-chosen");
    var wanted = real(el);
    chosen = wanted && wanted !== main ? wanted : null;
    if (chosen) chosen.setAttribute("data-chosen", "");
    placeGrips();
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
    if (!el) return;

    /*
     * The header and footer can be selected too, so their colours and type can
     * be changed from the same panel as everything else. What is written for
     * them is a rule rather than an inline style, because the chrome is
     * rendered from a template and an inline style on it would last until the
     * next render.
     */
    if (main.contains(el) || el.closest("header.site,footer.site")) pick(el);
  }, true);

  document.addEventListener("selectionchange", function () {
    var sel = document.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    var node = sel.anchorNode;
    if (!node || !main.contains(node)) return;
    var el = node.nodeType === 1 ? node : node.parentElement;
    if (el && el !== chosen && main.contains(el)) pick(el);
  });

  /*
   * The site's name and tagline, editable where they are read.
   *
   * They live in the header, which is otherwise not editable here: what is in
   * it comes from settings and from the shell the build designed, so typing
   * into it would put changes somewhere nothing reads back. These two are the
   * exception, because they are settings, and the place a person wants to
   * change a site's name is the place the name is written.
   *
   * Only these two elements are made editable, not the header around them.
   */
  /*
   * The settings written into the header and the footer, editable where they
   * are read.
   *
   * The chrome is otherwise not editable here: what is in it comes from the
   * shell the build designed, so typing into it would put changes somewhere
   * nothing reads back. These are the exception, because each of them is a
   * setting and has somewhere to go — the site's name and tagline, the words
   * under the footer's heading, the label on a link, and the title of a page
   * as it appears in a menu.
   *
   * Only these elements are made editable, never the chrome around them.
   */
  var SETTINGS = "[data-site-name],[data-site-tagline],[data-footer-text],[data-link],[data-page]";

  function fieldOf(el) {
    if (el.hasAttribute("data-site-name")) return { field: "name" };
    if (el.hasAttribute("data-site-tagline")) return { field: "tagline" };
    if (el.hasAttribute("data-footer-text")) return { field: "footerText" };
    if (el.hasAttribute("data-link")) return { field: "linkLabel", at: el.getAttribute("data-link") };
    return { field: "pageTitle", at: el.getAttribute("data-page") };
  }

  var settings = document.querySelectorAll(SETTINGS);
  for (var s = 0; s < settings.length; s++) {
    (function (el) {
      var what = fieldOf(el);
      // The footer's words are a paragraph and may have lines in them; every
      // other setting here is a single string.
      var lines = what.field === "footerText";
      var was = lines ? el.innerText : el.textContent;

      el.setAttribute("contenteditable", "true");
      el.setAttribute("title", "Click to change this");

      /*
       * A link is draggable, and pressing on draggable text starts a drag
       * rather than a selection, so the caret never lands and the field reads
       * as dead however editable it is. That goes for the element itself, when
       * it is the link, and for the anchors around it when it is not.
       */
      if (el.tagName === "A") el.setAttribute("draggable", "false");
      for (var up = el.parentElement; up; up = up.parentElement) {
        if (up.tagName === "A") up.setAttribute("draggable", "false");
        if (up.tagName === "HEADER" || up.tagName === "FOOTER") break;
      }

      el.addEventListener("input", function () {
        var now = lines ? el.innerText : el.textContent;
        if (now === was) return;
        was = now;

        /*
         * A name appears in the brand, in the copyright line and twice in the
         * footer, and it is one setting in all of them. The others are kept in
         * step here rather than by rebuilding the page, which would take the
         * cursor with it.
         */
        if (what.field === "name" || what.field === "tagline") {
          var twins = document.querySelectorAll(
            what.field === "name" ? "[data-site-name]" : "[data-site-tagline]",
          );
          for (var i = 0; i < twins.length; i++) {
            if (twins[i] !== el && twins[i].textContent !== now) twins[i].textContent = now;
          }
        }

        parent.postMessage(
          { preview: "site", field: what.field, at: what.at, text: now },
          "*",
        );
      });

      // A line break belongs in the footer's words and nowhere else here.
      if (!lines) {
        el.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); el.blur(); }
        });
      }
    })(settings[s]);
  }

  /*
   * Pressing the brand puts the cursor in the name.
   *
   * The name is a few words inside a logo link, usually beside an image, and
   * aiming at the text is a smaller target than it looks. A press anywhere on
   * the brand means the name, because there is nothing else in there to mean.
   *
   * Nothing is prevented here, deliberately. Preventing a mousedown stops the
   * frame this runs in from taking focus at all, and a field focused inside an
   * unfocused frame receives no typing — which looks exactly like a field that
   * cannot be edited, and was. So the browser has its turn first and the caret
   * is moved afterwards, once focus has landed wherever it was going to.
   */
  document.addEventListener("mousedown", function (e) {
    var el = e.target;
    while (el && el.nodeType !== 1) el = el.parentElement;
    if (!el || main.contains(el)) return;

    /*
     * Walk out to the brand, rather than to the nearest thing that looks like
     * one. A search for the nearest matching ancestor lands, for a press on a
     * logo, on the logo itself — and the name is not inside the logo, it is
     * beside it.
     *
     * Bounded, and never past the header. A navigation link sits inside an
     * element that contains the name too, several levels up, and clicking a
     * menu item should not put the cursor in the site's name.
     */
    var field = el.closest(SETTINGS);
    if (!field) {
      var up = el;
      for (var hop = 0; up && hop < 5; hop += 1, up = up.parentElement) {
        if (!up.tagName || up.tagName === "HEADER" || up.tagName === "FOOTER") break;
        var cls = (up.getAttribute("class") || "").toLowerCase();
        if (up.tagName !== "A" && !/brand|logo|site-?name|title/.test(cls)) continue;
        var found = up.querySelector("[data-site-name],[data-site-tagline]");
        if (found) { field = found; break; }
      }
    }
    if (!field) return;

    var x = e.clientX;
    var y = e.clientY;

    setTimeout(function () {
      if (document.activeElement !== field) field.focus();

      var sel = document.getSelection();
      var already = sel && sel.anchorNode &&
        field.contains(sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      if (already) return;

      // Where they pressed, if that can be worked out; the end of the text if
      // not, which is where somebody renaming something wants to be anyway.
      var range = document.caretRangeFromPoint ? document.caretRangeFromPoint(x, y) : null;
      if (!range || !field.contains(range.startContainer)) {
        range = document.createRange();
        range.selectNodeContents(field);
        range.collapse(false);
      }
      sel.removeAllRanges();
      sel.addRange(range);
    }, 0);
  }, true);


  /*
   * Dragging a box to the size you want.
   *
   * The panel has boxes for width and height, which means knowing the number
   * before you can have the size. Nobody knows the number. They know it should
   * be a bit wider, and the way to say that is to take hold of the edge and
   * pull it.
   *
   * Three handles: the right edge for width, the bottom for height, the corner
   * for both. Not the left or the top — those would mean moving the box as well
   * as sizing it, and a box in a flowing page does not have a position of its
   * own to move to.
   *
   * The handles live outside the page's own markup, in a layer of their own, so
   * nothing here is ever saved as part of the page.
   */
  var grips = document.createElement("div");
  grips.setAttribute("data-resizer", "");
  grips.innerHTML =
    '<i data-grip="e"></i><i data-grip="s"></i><i data-grip="se"></i><b></b>';
  document.body.appendChild(grips);
  var readout = grips.querySelector("b");

  function placeGrips() {
    if (!chosen) {
      grips.style.display = "none";
      return;
    }
    var r = chosen.getBoundingClientRect();
    grips.style.display = "block";
    grips.style.left = r.left + window.scrollX + "px";
    grips.style.top = r.top + window.scrollY + "px";
    grips.style.width = r.width + "px";
    grips.style.height = r.height + "px";
  }

  window.addEventListener("scroll", placeGrips, { passive: true });
  window.addEventListener("resize", placeGrips);

  grips.addEventListener("pointerdown", function (e) {
    var grip = e.target.getAttribute && e.target.getAttribute("data-grip");
    if (!grip || !chosen) return;

    e.preventDefault();
    e.target.setPointerCapture(e.pointerId);

    var box = chosen.getBoundingClientRect();
    var fromX = e.clientX;
    var fromY = e.clientY;
    var wide = box.width;
    var tall = box.height;
    var sized = chosen;

    readout.style.display = "block";

    function move(ev) {
      /*
       * Nothing below a size somebody could still grab.
       *
       * Dragged to nothing, a box has no edges left to take hold of, and the
       * only way back would be the panel — which is the thing this exists to
       * avoid needing.
       */
      if (grip.indexOf("e") >= 0) {
        sized.style.width = Math.max(24, Math.round(wide + ev.clientX - fromX)) + "px";
      }
      if (grip.indexOf("s") >= 0) {
        sized.style.height = Math.max(24, Math.round(tall + ev.clientY - fromY)) + "px";
      }
      var now = sized.getBoundingClientRect();
      readout.textContent = Math.round(now.width) + " x " + Math.round(now.height);
      placeGrips();
    }

    function stop() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", stop);
      readout.style.display = "none";

      /*
       * Where the new size is written down.
       *
       * Inside the page it is already there: the size is an inline style on the
       * element, and the page's markup is what gets saved. In the header or
       * footer there is no markup to save, so it goes the way every other
       * change there goes — as a rule against a name for the thing.
       */
      if (main.contains(sized)) {
        report();
      } else {
        var selector = selectorFor(sized);
        if (selector) {
          if (grip.indexOf("e") >= 0) {
            parent.postMessage(
              { preview: "chrome", selector: selector, key: "width", value: sized.style.width },
              "*",
            );
          }
          if (grip.indexOf("s") >= 0) {
            parent.postMessage(
              { preview: "chrome", selector: selector, key: "height", value: sized.style.height },
              "*",
            );
          }
        }
      }

      announce();
    }

    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", stop);
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

    if (m.do === "media") {
      media = Number(m.px) || 0;
    } else if (m.do === "style" && chosen) {
      /*
       * A style for one width goes in the stylesheet; a style for every width
       * stays where it always was.
       *
       * The header and footer are never width-specific here. They are rendered
       * from a template, so there is no markup on them to hang a marker off,
       * and a rule naming an element that is built afresh every render has
       * nothing dependable to point at. The panel says so rather than letting
       * the change quietly go to the wrong width.
       */
      if (media && main.contains(chosen)) {
        styleAt(chosen, m.key, m.value);
      } else {
        // Set here for the sake of seeing it immediately; kept by the rule.
        chosen.style[m.key] = m.value;

        if (!main.contains(chosen)) {
          var selector = selectorFor(chosen);
          if (selector) {
            parent.postMessage(
              { preview: "chrome", selector: selector, key: m.key, value: m.value },
              "*",
            );
          }
        }
      }
    } else if (m.do === "insert") {
      /*
       * Something new in the page.
       *
       * Everything else here changes what is already there. Until now the only
       * way to add anything was to type, or to place a picture, so a page could
       * be restyled and reordered and pruned but never grown.
       *
       * It lands after the block containing whatever is selected, which is
       * where somebody who clicked a section and then reached for a new one
       * means it to go. With nothing selected it goes at the end.
       */
      var slot = document.createElement("div");
      slot.innerHTML = String(m.html || "");

      var chosenMarks = slot.querySelectorAll("[data-chosen]");
      for (var c = 0; c < chosenMarks.length; c++) chosenMarks[c].removeAttribute("data-chosen");

      /*
       * Markers, renamed rather than kept or thrown away.
       *
       * A marker names a rule in one page's stylesheet. Kept, it either collides
       * with an element already answering to that name or points at a rule that
       * is not on this page. Thrown away, the block arrives having quietly lost
       * every width-specific style somebody set on it, which is the worse of the
       * two because nothing says so.
       *
       * So a copy travels with its rules, and they are written back in here
       * under names minted for this page.
       */
      var carried = m.styles && typeof m.styles === "object" ? m.styles : null;
      if (carried) readRules();

      var stamped = slot.querySelectorAll("[data-r]");
      var rewrote = false;
      for (var s = 0; s < stamped.length; s++) {
        var was = stamped[s].getAttribute("data-r");
        var mine = carried ? carried[was] : null;
        if (!mine) {
          stamped[s].removeAttribute("data-r");
          continue;
        }

        marks += 1;
        var now = "r" + marks;
        stamped[s].setAttribute("data-r", now);

        for (var px in mine) {
          var bag = rules[px] || (rules[px] = {});
          var fresh = {};
          for (var key in mine[px]) fresh[key] = mine[px][key];
          bag[now] = fresh;
        }
        rewrote = true;
      }
      if (rewrote) writeRules();

      var landing = document.createDocumentFragment();
      var arrived = null;
      while (slot.firstChild) {
        if (!arrived && slot.firstChild.nodeType === 1) arrived = slot.firstChild;
        landing.appendChild(slot.firstChild);
      }

      var anchor = chosen && main.contains(chosen) ? topOf(chosen) : null;
      if (anchor) anchor.after(landing);
      else main.appendChild(landing);

      if (arrived) {
        pick(arrived);
        arrived.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    } else if (m.do === "copy" && chosen) {
      var taken = chosen.cloneNode(true);
      taken.removeAttribute("data-chosen");
      var alsoChosen = taken.querySelectorAll("[data-chosen]");
      for (var t = 0; t < alsoChosen.length; t++) alsoChosen[t].removeAttribute("data-chosen");

      /*
       * The rules that belong to it, taken along.
       *
       * Markup alone would arrive on the other page having lost every style set
       * for a narrower width, and lost it silently, which is the kind of thing
       * somebody discovers on a phone a week later.
       */
      readRules();
      var mine = [];
      if (taken.getAttribute("data-r")) mine.push(taken.getAttribute("data-r"));
      var within = taken.querySelectorAll("[data-r]");
      for (var w = 0; w < within.length; w++) mine.push(within[w].getAttribute("data-r"));

      var packed = {};
      for (var at in rules) {
        for (var n = 0; n < mine.length; n++) {
          var one = rules[at][mine[n]];
          if (!one) continue;
          if (!packed[mine[n]]) packed[mine[n]] = {};
          packed[mine[n]][at] = one;
        }
      }

      parent.postMessage(
        { preview: "copied", html: taken.outerHTML, label: describe(chosen), styles: packed },
        "*",
      );
      // Nothing on the page changed, so nothing below needs to run.
      return;
    } else if (m.do === "choose") {
      var wanted = main.children[Number(m.at)];
      if (wanted) {
        pick(wanted);
        wanted.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      return;
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
    } else if (m.do === "move" && chosen && main.contains(chosen)) {
      /*
       * Up or down among the things beside it.
       *
       * Only inside the page. The header and footer are rendered from a
       * template, so an order changed there would be undone by the next render
       * and there is nowhere to write it down.
       *
       * It swaps with the neighbour rather than moving by a measurement: a
       * block in a flowing page has an order, not a position, and "after the
       * next one" is the only thing moving down can mean.
       */
      var beside = m.by < 0 ? chosen.previousElementSibling : chosen.nextElementSibling;
      if (beside) {
        if (m.by < 0) beside.before(chosen);
        else beside.after(chosen);
        chosen.scrollIntoView({ block: "nearest" });
      }
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

    placeGrips();
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
    "main [contenteditable],main{cursor:text}" +
    // The two settings in the header, marked as editable and given something
    // to show when they are empty. Drawn rather than written, so a prompt
    // cannot be mistaken for a value and saved.
    "[data-site-name],[data-site-tagline],[data-footer-text],[data-link],[data-page]" +
    "{cursor:text;outline-offset:2px}" +
    "[data-site-name]:hover,[data-site-tagline]:hover,[data-footer-text]:hover," +
    "[data-link]:hover,[data-page]:hover{outline:1px dashed rgba(127,127,127,.6)}" +
    "[data-site-name]:focus,[data-site-tagline]:focus,[data-footer-text]:focus," +
    "[data-link]:focus,[data-page]:focus{outline:2px solid #2f6df6}" +
    "[data-resizer]{position:absolute;pointer-events:none;z-index:2147483646;display:none}" +
    "[data-resizer] i{position:absolute;pointer-events:auto;width:13px;height:13px;" +
    "background:#2f6df6;border:2px solid #fff;border-radius:3px;" +
    "box-shadow:0 1px 3px rgba(0,0,0,.35);touch-action:none}" +
    "[data-resizer] i[data-grip=e]{right:-7px;top:50%;margin-top:-7px;cursor:ew-resize}" +
    "[data-resizer] i[data-grip=s]{bottom:-7px;left:50%;margin-left:-7px;cursor:ns-resize}" +
    "[data-resizer] i[data-grip=se]{right:-7px;bottom:-7px;cursor:nwse-resize}" +
    "[data-resizer] b{position:absolute;right:0;top:-25px;display:none;" +
    "background:#2f6df6;color:#fff;border-radius:4px;padding:2px 7px;" +
    "font:600 11px/1.5 ui-sans-serif,system-ui,sans-serif;white-space:nowrap}" +
    "[data-site-name]:empty::before,[data-site-tagline]:empty::before," +
    "[data-footer-text]:empty::before,[data-link]:empty::before,[data-page]:empty::before" +
    "{content:attr(data-placeholder);opacity:.45}";
  document.head.appendChild(style);

  /*
   * Escape, sent outward.
   *
   * The console listens for it too, but a key pressed inside this frame never
   * reaches the page around it — and full screen is precisely the state in
   * which the cursor is in here. So the frame says so and the console decides
   * what leaving means.
   */
  /*
   * Undo, redo and save, sent outward for the same reason Escape is.
   *
   * The console keeps the history, because the console is what knows what the
   * page said before this keystroke and what it will be saved as. But the
   * cursor is in here, so this is where the keys land.
   *
   * The browser's own undo has to be stopped, not merely ignored. It rewinds
   * the editable region on its own and the console's history knows nothing
   * about it, so the two drift apart and the next real undo puts back a version
   * that never existed.
   */
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      parent.postMessage({ preview: "escape" }, "*");
      return;
    }

    if (!e.metaKey && !e.ctrlKey) return;
    var key = String(e.key || "").toLowerCase();

    if (key === "z") {
      e.preventDefault();
      parent.postMessage({ preview: "history", back: !e.shiftKey }, "*");
    } else if (key === "y") {
      e.preventDefault();
      parent.postMessage({ preview: "history", back: false }, "*");
    } else if (key === "s") {
      e.preventDefault();
      parent.postMessage({ preview: "save" }, "*");
    }
  });

  parent.postMessage({ preview: "ready" }, "*");
  outline();
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
/**
 * Whether a placeholder in a designed shell sits in text or in an attribute.
 *
 * A design writes {{NAME}} wherever it wants the site called by name, and that
 * is usually between tags but is sometimes inside one — an alt, a title, an
 * aria-label. Wrapping the second kind in a span would put markup inside a
 * quoted attribute value and break the tag around it.
 *
 * Decided by walking back to the nearest angle bracket: an unclosed "<" before
 * it means the placeholder is inside a tag.
 */
function inTag(whole: string, at: number): boolean {
  const open = whole.lastIndexOf("<", at);
  const close = whole.lastIndexOf(">", at);
  return open > close;
}

/**
 * The site's name or tagline, marked so the editor can find it.
 *
 * Only while editing, and only where it is text rather than an attribute. Left
 * exactly as it was in every other case, so what gets published carries no
 * trace of having been editable.
 */
function mark(
  value: string,
  attribute: string,
  editing: boolean | undefined,
  whole: string,
  at: number,
): string {
  if (!editing || inTag(whole, at)) return value;
  return `<span ${attribute} data-editor-wrap data-placeholder="${
    attribute === "data-site-name" ? "Name the site" : "Add a tagline"
  }">${value}</span>`;
}

/**
 * The site's name, wrapped so the editor can find it.
 *
 * It appears in four places — the brand, the copyright line, the footer's
 * opening words and the line at the very bottom — and a name is one setting
 * wherever it is written. Marked in all of them, and kept in step by the editor
 * while somebody types into any one.
 */
function nameHere(site: ShellSite, options: ShellOptions): string {
  const text = escapeText(site.name);
  return options.editing
    ? `<span data-site-name data-editor-wrap data-placeholder="Name the site">${text}</span>`
    : text;
}

/** A link whose label is a setting, so the editor can offer to change it. */
function markedLink(
  href: string,
  label: string,
  where: string,
  editing: boolean | undefined,
): string {
  const mark = editing ? ` data-link="${where}" data-placeholder="Name this link"` : "";
  return `<a href="${escapeText(href)}"${mark}>${escapeText(label)}</a>`;
}

/**
 * A page's entry in a menu.
 *
 * Its text is the page's title, which is a page setting rather than a menu one,
 * so typing here changes the page it points at — including from a page that is
 * not the one on screen.
 */
function markedPage(page: ShellPage, options: ShellOptions): string {
  const mark = options.editing ? ` data-page="${escapeText(page.slug)}"` : "";
  return `<a href="${escapeText(linkTo(page, options))}"${mark}>${escapeText(page.title)}</a>`;
}

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
    .replace(/\{\{\s*NAME\s*\}\}/g, (_m, at: number, whole: string) =>
      mark(escapeText(site.name), "data-site-name", options.editing, whole, at),
    )
    // Empty when the header says not to show it, so a design cannot put back
    // what the setting just took away.
    .replace(/\{\{\s*TAGLINE\s*\}\}/g, (_m, at: number, whole: string) =>
      site.header.showTagline
        ? mark(escapeText(site.tagline), "data-site-tagline", options.editing, whole, at)
        : "",
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
      const mark = options.editing ? ` data-page="${escapeText(p.slug)}"` : "";
      return `<a href="${escapeText(linkTo(p, options))}"${here}${mark}>${escapeText(p.title)}</a>`;
    })
    .join("\n          ");

  const extraLinks = h.links
    .map((l, i) => markedLink(l.url, l.label, `header:${i}`, options.editing))
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
    h.showName
      ? `<span class="brand-name"${
          options.editing ? ' data-site-name data-placeholder="Name the site"' : ""
        }>${escapeText(site.name)}</span>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  const brand = brandInner
    ? `<a class="brand" href="${escapeText(home ? linkTo(home, options) : "/")}">
          ${brandInner}
          ${
            // Shown while editing even when empty, so there is something to
            // click. A placeholder drawn by CSS rather than written into the
            // element, since text put there to be helpful would be saved as
            // though somebody had meant it.
            h.showTagline && (site.tagline || options.editing)
              ? `<p class="brand-tagline"${
                  options.editing ? ' data-site-tagline data-placeholder="Add a tagline"' : ""
                }>${escapeText(site.tagline)}</p>`
              : ""
          }
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
        ? `<span class="brand-name">${nameHere(site, options)}</span>`
        : "",
    nav: h.showNav ? pageLinks : "",
    pages: ordered.map((p) => markedPage(p, options)).join(""),
    links: h.showNav
      ? h.links.map((l, i) => markedLink(l.url, l.label, `header:${i}`, options.editing)).join("")
      : "",
    copyright: f.showCopyright ? `&copy; ${options.year ?? ""} ${nameHere(site, options)}` : "",
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

  /*
   * The footer's opening words, which are two settings in one paragraph.
   *
   * The name and the text sit side by side, so each is wrapped separately —
   * marking the paragraph would make typing anywhere in it look like a change
   * to whichever of the two the editor guessed.
   *
   * Shown while editing even when empty, since a paragraph nobody has written
   * yet is one nobody can click on to start.
   */
  const words = f.text
    .split(/\n+/)
    .map((l) => escapeText(l))
    .join("<br>");

  const about =
    f.text || site.name || options.editing
      ? `<p class="footer-about">${
          f.showCopyright || site.name ? `<strong>${nameHere(site, options)}</strong>` : ""
        }${
          options.editing
            ? `<span data-footer-text data-editor-wrap data-placeholder="Say something about the site">${words}</span>`
            : words
        }</p>`
      : "";

  const footerNav = f.links.length
    ? `<nav>${f.links
        .map((l, i) => markedLink(l.url, l.label, `footer:${i}`, options.editing))
        .join("")}</nav>`
    : "";

  const pageNav =
    ordered.length > 1
      ? `<nav>${ordered.map((p) => markedPage(p, options)).join("")}</nav>`
      : "";

  const base = f.showCopyright
    ? `<div class="footer-base"><span>&copy; ${options.year ?? ""} ${nameHere(site, options)}</span></div>`
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
  <main class="wrap is-page">
    <h1 data-title>${escapeText(page.title)}</h1>
    ${options.editing ? inertScripts(page.bodyHtml) : page.bodyHtml}
  </main>
${footer}
${options.editing ? `<script>${EDIT_SCRIPT}</script>` : options.interactive ? `<script>${NAV_SCRIPT}</script>` : ""}
</body>
</html>`;
}
