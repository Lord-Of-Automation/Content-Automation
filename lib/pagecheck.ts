/**
 * What is wrong with a site, before it goes out.
 *
 * This console exists to make pages that rank and get read, and the two things
 * that stop that are boring and unglamorous: a picture nobody can describe, and
 * a link that goes nowhere. Neither shows up in a preview. A page with a broken
 * link looks exactly like a page without one until somebody clicks it, and a
 * missing alt attribute looks like nothing at all to the person who can see the
 * picture.
 *
 * So they are counted here rather than found later. Every check is something a
 * person can act on in the editor in under a minute, which is the bar for
 * including one: a warning nobody can fix is a warning everybody learns to
 * ignore, and then the real ones go unread too.
 *
 * Two severities and no more. Bad means it is broken for somebody: a link that
 * cannot be followed, a picture that cannot be seen or described. Worth a look
 * means it will cost traffic or clarity but nothing is broken.
 *
 * Parsed with the browser's own parser rather than by matching text. Markup
 * written by a model is markup written by a model, and a regular expression
 * that thinks it understands nested tags is how a check ends up reporting
 * problems that are not there.
 */

export interface Finding {
  /** Which page, by slug. The front page's slug is empty. */
  page: string;
  pageTitle: string;
  level: "bad" | "warn";
  /** A few words naming the kind, for grouping. */
  kind: string;
  what: string;
  /** The offending text, address or markup, when quoting it helps. */
  detail?: string;
}

interface Checkable {
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  bodyHtml: string;
}

/** What Google shows, near enough, so the limits mean something. */
const TITLE_LIMIT = 60;
const DESC_LIMIT = 155;

/** A word that says nothing about the thing it links to. */
const EMPTY_LINK_WORDS = new Set([
  "here", "click here", "this", "read more", "more", "link", "click", "learn more",
]);

/**
 * Whether an address points somewhere else entirely.
 *
 * Anything with a scheme goes out into the world and is not this site's to
 * check: a link to somebody else's page may be dead, but finding that out means
 * fetching it, and a check that makes fifty requests every time somebody opens
 * a tab is a check that gets switched off.
 */
function leavesTheSite(href: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

/** The slug a relative address resolves to, or null if it is not one. */
function slugOf(href: string): string | null {
  if (!href || href.startsWith("#") || leavesTheSite(href)) return null;
  const cleaned = href
    .replace(/[?#].*$/, "")
    .replace(/^[./]+/, "")
    .replace(/\.html?$/i, "")
    .replace(/\/$/, "");
  return cleaned === "index" ? "" : cleaned;
}

function bodyOf(html: string): HTMLElement | null {
  if (typeof DOMParser === "undefined") return null;
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return parsed.body;
}

function words(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function shorten(value: string, most = 70): string {
  const flat = words(value);
  return flat.length > most ? `${flat.slice(0, most - 1)}…` : flat;
}

/**
 * Everything worth saying about one site.
 *
 * Ordered so the list reads top to bottom in the order somebody would fix it:
 * broken things first, then by page in the order the pages appear.
 */
export function checkSite(pages: Checkable[]): Finding[] {
  const found: Finding[] = [];
  const slugs = new Set(pages.map((p) => p.slug));

  /*
   * The same title or the same description on two pages.
   *
   * Counted across the whole site rather than per page, because neither is a
   * problem on its own — it is the second one that makes the first wrong, and
   * saying so on both is how somebody knows which two to compare.
   */
  const titleSeen = new Map<string, number>();
  const descSeen = new Map<string, number>();
  const slugSeen = new Map<string, number>();
  for (const page of pages) {
    const title = words(page.metaTitle).toLowerCase();
    const desc = words(page.metaDescription).toLowerCase();
    if (title) titleSeen.set(title, (titleSeen.get(title) ?? 0) + 1);
    if (desc) descSeen.set(desc, (descSeen.get(desc) ?? 0) + 1);
    slugSeen.set(page.slug, (slugSeen.get(page.slug) ?? 0) + 1);
  }

  for (const page of pages) {
    const at = (level: Finding["level"], kind: string, what: string, detail?: string) =>
      found.push({ page: page.slug, pageTitle: page.title, level, kind, what, detail });

    // ------------------------------------------------------- what it says
    if (!words(page.title)) {
      at("bad", "Title", "This page has no title, so it has no name in the menu.");
    }
    if (!words(page.metaTitle)) {
      at("warn", "Meta title", "No meta title, so search results will show whatever they can find.");
    } else if (words(page.metaTitle).length > TITLE_LIMIT) {
      at(
        "warn",
        "Meta title",
        `The meta title is longer than search results show, so the end will be cut.`,
        `${words(page.metaTitle).length} characters, against ${TITLE_LIMIT}`,
      );
    }

    if (!words(page.metaDescription)) {
      at(
        "warn",
        "Meta description",
        "No meta description, so search results will quote the page at random.",
      );
    } else if (words(page.metaDescription).length > DESC_LIMIT) {
      at(
        "warn",
        "Meta description",
        "The meta description is longer than search results show, so the end will be cut.",
        `${words(page.metaDescription).length} characters, against ${DESC_LIMIT}`,
      );
    }

    if ((titleSeen.get(words(page.metaTitle).toLowerCase()) ?? 0) > 1) {
      at("warn", "Meta title", "Another page has exactly this meta title.");
    }
    if ((descSeen.get(words(page.metaDescription).toLowerCase()) ?? 0) > 1) {
      at("warn", "Meta description", "Another page has exactly this meta description.");
    }
    if ((slugSeen.get(page.slug) ?? 0) > 1) {
      at("bad", "Address", "Two pages share this address, so one of them cannot be reached.");
    }

    // ------------------------------------------------------ what is in it
    const body = bodyOf(page.bodyHtml);
    if (!body) continue;

    if (!words(body.textContent ?? "")) {
      at("bad", "Empty", "There is nothing on this page but its title.");
      continue;
    }

    for (const img of Array.from(body.querySelectorAll("img"))) {
      const src = (img.getAttribute("src") ?? "").trim();
      const alt = img.getAttribute("alt");

      if (!src) {
        at("bad", "Picture", "A picture has no address, so nothing will load.", shorten(img.outerHTML));
      }
      if (alt === null) {
        at(
          "bad",
          "Picture",
          "A picture has no description, so a screen reader announces nothing.",
          shorten(src || img.outerHTML),
        );
      } else if (!words(alt)) {
        at(
          "warn",
          "Picture",
          "A picture is marked as decorative with an empty description. Right for a flourish, wrong for anything that carries meaning.",
          shorten(src),
        );
      }
    }

    for (const link of Array.from(body.querySelectorAll("a"))) {
      const href = (link.getAttribute("href") ?? "").trim();
      const label = words(link.textContent ?? "");
      const holdsPicture = !!link.querySelector("img,svg");

      if (!href) {
        at("bad", "Link", "A link has no address.", shorten(label || link.outerHTML));
        continue;
      }
      if (href === "#") {
        at(
          "bad",
          "Link",
          "A link points at nothing. This is what a placeholder looks like after it is forgotten.",
          shorten(label),
        );
        continue;
      }
      if (/^javascript:/i.test(href)) {
        at("bad", "Link", "A link runs a script instead of going somewhere.", shorten(label));
        continue;
      }

      const wanted = slugOf(href);
      if (wanted !== null && !slugs.has(wanted)) {
        at(
          "bad",
          "Link",
          "A link points at a page on this site that does not exist.",
          `${href} from “${shorten(label, 40)}”`,
        );
      }

      if (!label && !holdsPicture) {
        at("bad", "Link", "A link has no words in it, so there is nothing to click.", href);
      } else if (label && EMPTY_LINK_WORDS.has(label.toLowerCase())) {
        at(
          "warn",
          "Link",
          "A link says nothing about where it goes, which is a problem for search and for anybody reading the links alone.",
          `“${label}” → ${shorten(href, 40)}`,
        );
      }
    }

    /*
     * Headings, in the order they appear.
     *
     * The page's own h1 is the title, supplied by the shell around the body, so
     * a second one inside the body is a page claiming two names. Skipping a
     * level is the other half: an h2 followed by an h4 reads to a screen reader
     * and to a crawler as a section with a hole in it.
     */
    const headings = Array.from(body.querySelectorAll("h1,h2,h3,h4,h5,h6"));
    let previous = 1;
    for (const heading of headings) {
      const level = Number(heading.tagName.slice(1));

      if (level === 1) {
        at(
          "warn",
          "Headings",
          "There is a second top-level heading in the body. The page title is already one.",
          shorten(heading.textContent ?? ""),
        );
      }
      if (level > previous + 1) {
        at(
          "warn",
          "Headings",
          `A heading jumps from level ${previous} to level ${level}, skipping one.`,
          shorten(heading.textContent ?? ""),
        );
      }
      if (!words(heading.textContent ?? "")) {
        at("warn", "Headings", "There is an empty heading.");
      }
      previous = level;
    }

    for (const table of Array.from(body.querySelectorAll("table"))) {
      if (!table.querySelector("th")) {
        at(
          "warn",
          "Table",
          "A table has no header row, so its columns are unlabelled for anybody who cannot see the layout.",
          shorten(table.textContent ?? "", 50),
        );
      }
    }
  }

  return found.sort((a, b) => (a.level === b.level ? 0 : a.level === "bad" ? -1 : 1));
}
