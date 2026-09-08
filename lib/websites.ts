/**
 * Websites this platform wrote, before anything hosts them.
 *
 * A site here is prose and nothing else: pages with titles, bodies and meta,
 * in an order. It has no domain, no host and no address, because none of those
 * has been decided yet. That is the point of it existing at this stage at all —
 * somebody reads what the AI produced, fixes what is wrong, and only then
 * decides where it should live and in what form.
 *
 * The engine writes these and hands them over. It keeps the site in a run's
 * artifacts, which expire after a few days by design, so a site that is going
 * to outlive that has to be copied somewhere that does not. This is that
 * somewhere.
 *
 * Nothing here is a secret, so it is stored in the clear beside the schedules
 * and the domain groups rather than through the credential store.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { kvConfigured, kvGetJSON, kvSetJSON } from "./kv";

const KEY = "content-automation:websites";
const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "websites.json");

export interface WebsitePage {
  /** "about-us". The front page's slug is empty. */
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  bodyHtml: string;
  keywords: string[];
  /** Menu order, lowest first. */
  order: number;
}

/**
 * The parts of a site that are not any one page.
 *
 * Kept as data rather than baked into the renderer, because "change the footer"
 * is the second thing anybody wants after "change the words" and neither should
 * mean editing markup. What the renderer keeps is the arrangement; what lives
 * here is every decision inside it.
 */
export interface SiteLink {
  label: string;
  url: string;
}

export interface SiteHeader {
  /** An image instead of the name in words. Empty means use the name. */
  logoUrl: string;
  showName: boolean;
  showTagline: boolean;
  /** Whether the pages appear as navigation at all. */
  showNav: boolean;
  /** Anything beyond the pages: a shop, a booking form, somewhere else. */
  links: SiteLink[];
}

export interface SiteFooter {
  text: string;
  links: SiteLink[];
  /** A line saying who owns it, with the year filled in when rendered. */
  showCopyright: boolean;
}

/**
 * A header and footer designed for this site by the build.
 *
 * Null when the build skipped it or the site predates it, and the renderer
 * draws its own instead. Kept editable like everything else: it is markup and
 * CSS somebody may want to change.
 */
export interface SiteDesign {
  headerHtml: string;
  footerHtml: string;
  css: string;
}

export interface SiteTheme {
  /** Links, and anything the design wants to draw the eye to. */
  accent: string;
  background: string;
  ink: string;
  font: "sans" | "serif";
  /** How wide the text column runs, in pixels. */
  width: number;
}

/**
 * What a site looks like before anybody changes it.
 *
 * Applied when a record is read rather than when one is written, so a site
 * created before any of this existed gets the defaults instead of a page with
 * no header and a footer that renders as "undefined".
 */
export const DEFAULT_HEADER: SiteHeader = {
  logoUrl: "",
  showName: true,
  showTagline: true,
  showNav: true,
  links: [],
};

export const DEFAULT_FOOTER: SiteFooter = {
  text: "",
  links: [],
  showCopyright: true,
};

export const DEFAULT_THEME: SiteTheme = {
  accent: "#2f6df6",
  background: "#ffffff",
  ink: "#1b2430",
  font: "sans",
  width: 760,
};

/**
 * Where a site was last published, and what it became there.
 *
 * The page ids are the part that matters. Publishing the same site twice has to
 * update the pages it made the first time rather than leave a second copy of
 * each behind, and a slug is not enough to go on — somebody may have renamed a
 * page here, or renamed it there. So what WordPress called each page is kept,
 * keyed by what this console calls it.
 *
 * Null until a site has been published, which is most of them.
 */
export interface PublishedTo {
  /** The site it went to, as an address. */
  address: string;
  /** Which connected host it belongs to, or empty when typed in by hand. */
  host: string;
  /** A label for the target, so the editor can name it without asking a host. */
  label: string;
  /** WordPress page ids, keyed by this console's slug for the page. */
  pages: Record<string, number>;
  /** Whether the pages went up live or as drafts. */
  status: "publish" | "draft";
  /** Whether the generated design travelled with them. */
  withDesign: boolean;
  /**
   * How much of the target's theme the pages kept.
   *
   * Recorded because it is the first thing worth knowing when a published page
   * does not look right: a page that kept the theme's header was not a page
   * that failed to take it over.
   */
  fit: "canvas" | "inside" | "theme";
  at: string;
  by: string;
}

export interface Website {
  id: string;
  name: string;
  tagline: string;
  /** The brief it was written from, kept so it can be rewritten later. */
  description: string;
  topic: string;
  keywords: string[];
  format: "wordpress" | "static";
  language: string;
  /**
   * Where it is up to.
   *
   * "building" is a run still writing it. "ready" has pages. "failed" is a run
   * that ended without producing any, and keeps its reason: a site with no
   * pages and no explanation is indistinguishable from a bug in this console.
   */
  status: "building" | "ready" | "failed";
  /** The engine run that wrote it, so its log is one click away. */
  runId: string;
  /** How many pages were asked for, so progress can be read as a fraction. */
  wanted: number;
  note: string;
  pages: WebsitePage[];
  header: SiteHeader;
  footer: SiteFooter;
  theme: SiteTheme;
  design: SiteDesign | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  /** Where it was last published, or null. */
  published: PublishedTo | null;
}

/** Enough to be useful, few enough that the list stays a list. */
const MAX_SITES = 200;
const MAX_PAGES = 60;

/** What a person is allowed to type into one field, so a paste cannot bloat. */
const MAX_BODY = 200_000;
const MAX_LINE = 300;

async function read(): Promise<Website[]> {
  if (kvConfigured()) {
    const rows = await kvGetJSON<Website[]>(KEY);
    if (Array.isArray(rows)) return rows;
  }
  try {
    if (existsSync(FILE)) {
      const parsed = JSON.parse(readFileSync(FILE, "utf8")) as Website[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // A corrupt file reads as no sites rather than taking the page down.
  }
  return [];
}

async function write(rows: Website[]): Promise<void> {
  const capped = rows.slice(0, MAX_SITES);
  if (kvConfigured()) {
    await kvSetJSON(KEY, capped);
    return;
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(capped, null, 2), "utf8");
}

export function newWebsiteId(): string {
  return `site-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Newest first: the one you just made is the one you want. */
export async function listWebsites(): Promise<Website[]> {
  const rows = await read();
  return [...rows]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(withDefaults);
}

export async function getWebsite(id: string): Promise<Website | null> {
  const found = (await read()).find((w) => w.id === id);
  return found ? withDefaults(found) : null;
}

export async function saveWebsite(site: Website): Promise<void> {
  const rows = await read();
  const at = rows.findIndex((w) => w.id === site.id);
  if (at >= 0) rows[at] = site;
  else rows.unshift(site);
  await write(rows);
}

export async function removeWebsite(id: string): Promise<boolean> {
  const rows = await read();
  const left = rows.filter((w) => w.id !== id);
  if (left.length === rows.length) return false;
  await write(left);
  return true;
}

/** What the engine hands over when asked what a build has written. */
export interface BuiltPayload {
  status: string;
  complete: boolean;
  /** Whether the run has stopped, however it stopped. */
  finished?: boolean;
  /** Why it stopped, when it stopped badly. */
  error?: string | null;
  /** Null when the run ended before writing anything. */
  site: null | {
    name?: string;
    tagline?: string;
    language?: string;
    /** The header and footer the build designed. */
    shell?: unknown;
    /** The palette the plan chose for this subject. */
    accent?: string;
    background?: string;
    ink?: string;
    font?: string;
    pages?: unknown;
  };
}

/** A run that has stopped, however it stopped. */
function runEnded(status: string): boolean {
  return status === "success" || status === "error" || status === "canceled";
}

/**
 * Fold what a run has written into the stored site.
 *
 * The settling rule is the part worth getting right, and the first version got
 * it wrong: it only finished a site when the run succeeded, so a build that was
 * cancelled or failed stayed "writing" for ever and the page polled a run that
 * had stopped. Any ending settles it now.
 *
 * How it ended decides the wording, not whether the pages are kept. A run
 * stopped after three of five pages wrote three real pages, and throwing them
 * away because the fourth never came would be discarding work somebody paid
 * for. So pages win: whatever exists becomes the site, and the note says how it
 * came to stop.
 */
export function settleFrom(site: Website, built: BuiltPayload | null, actor: string): Website {
  // Nothing came back at all: the engine is unreachable or the run is gone.
  // Leave it alone; the next read may know more.
  if (!built) return site;

  const ended = built.finished ?? runEnded(built.status);

  /**
   * A run that ended having written nothing.
   *
   * This is what a build looks like when it fails while planning, and it used
   * to leave a site at "writing" for ever: the engine answered the request for
   * its pages with a 404, the console could not tell that apart from any other
   * failed request, and went on waiting for a run that had already stopped.
   */
  if (!built.site) {
    if (!ended) return site;
    return {
      ...site,
      status: "failed",
      note:
        built.error ||
        (built.status === "canceled"
          ? "Stopped before it wrote anything."
          : "The run ended without writing any pages."),
      updatedAt: new Date().toISOString(),
      updatedBy: actor,
    };
  }

  const pages = cleanPages(built.site.pages);

  const note = !ended
    ? site.note
    : pages.length
      ? built.status === "success"
        ? ""
        : built.status === "canceled"
          ? `Stopped after ${pages.length} page${pages.length === 1 ? "" : "s"}. What it wrote is here.`
          : `The run failed after ${pages.length} page${pages.length === 1 ? "" : "s"}. What it wrote is here.`
      : built.status === "canceled"
        ? "Stopped before it wrote anything."
        : "The run ended without writing any pages.";

  /**
   * The palette the plan chose, but only while nobody has chosen otherwise.
   *
   * A build picks colours for its subject, which beats arriving blue. Taking
   * them on every read would be worse than never taking them: a site whose
   * colours somebody had adjusted would snap back to the model's choice the
   * next time the page loaded.
   */
  const untouched = site.pages.length === 0;
  const theme = untouched
    ? cleanTheme({
        accent: built.site.accent,
        background: built.site.background,
        ink: built.site.ink,
        font: built.site.font,
        width: site.theme?.width,
      })
    : site.theme;

  return {
    ...site,
    name: site.name || String(built.site.name ?? ""),
    tagline: String(built.site.tagline ?? "") || site.tagline,
    language: String(built.site.language ?? "") || site.language,
    theme,
    // Taken while nobody has changed it, on the same terms as the palette.
    design: untouched ? cleanDesign(built.site.shell) : site.design,
    pages,
    status: !ended ? "building" : pages.length ? "ready" : "failed",
    note,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  };
}

function line(value: unknown, cap = MAX_LINE): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, cap);
}

/** A colour a browser will accept, or the default rather than nothing. */
function colour(value: unknown, fallback: string): string {
  const raw = String(value ?? "").trim();
  return /^#[0-9a-f]{3}$|^#[0-9a-f]{6}$/i.test(raw) ? raw : fallback;
}

function links(value: unknown): SiteLink[] {
  const list = Array.isArray(value) ? value : [];
  return list
    .slice(0, 12)
    .map((raw) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      return { label: line(item.label, 60), url: line(item.url, 300) };
    })
    .filter((l) => l.label && l.url);
}

export function cleanHeader(raw: unknown): SiteHeader {
  const h = (raw ?? {}) as Record<string, unknown>;
  return {
    logoUrl: line(h.logoUrl, 500),
    showName: h.showName !== false,
    showTagline: h.showTagline !== false,
    showNav: h.showNav !== false,
    links: links(h.links),
  };
}

export function cleanFooter(raw: unknown): SiteFooter {
  const f = (raw ?? {}) as Record<string, unknown>;
  return {
    text: String(f.text ?? "").trim().slice(0, 1000),
    links: links(f.links),
    showCopyright: f.showCopyright !== false,
  };
}

export function cleanTheme(raw: unknown): SiteTheme {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    accent: colour(s.accent, DEFAULT_THEME.accent),
    background: colour(s.background, DEFAULT_THEME.background),
    ink: colour(s.ink, DEFAULT_THEME.ink),
    font: s.font === "serif" ? "serif" : "sans",
    // Narrow enough to read, wide enough for a table. Outside that is a
    // typo rather than a preference.
    width: Math.max(480, Math.min(1400, Number(s.width) || DEFAULT_THEME.width)),
  };
}

/**
 * A stored record, made whole.
 *
 * Every read goes through this. A site written before headers existed has none,
 * and a renderer handed one of those would draw "undefined" where the footer
 * should be.
 */
export function cleanDesign(raw: unknown): SiteDesign | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const headerHtml = String(d.headerHtml ?? "").slice(0, MAX_BODY);
  const footerHtml = String(d.footerHtml ?? "").slice(0, MAX_BODY);
  const css = String(d.css ?? "").slice(0, MAX_BODY);
  // A design with nothing in it is no design, and storing an empty one would
  // put an empty header on every page instead of falling back to the built-in.
  if (!headerHtml && !footerHtml) return null;
  return { headerHtml, footerHtml, css };
}

export function withDefaults(site: Website): Website {
  return {
    ...site,
    header: cleanHeader(site.header),
    footer: cleanFooter(site.footer),
    theme: cleanTheme(site.theme),
    design: cleanDesign(site.design),
    // Sites written before publishing existed have no record of it, which is
    // the same thing as never having been published.
    published: site.published ?? null,
  };
}

/**
 * A page as it arrives from an edit.
 *
 * Trimmed rather than validated. What a person types into a page is their
 * business; what this refuses is only the shapes that would break something —
 * a slug that is not a slug, a body large enough to be an accident.
 *
 * The front page keeps its empty slug. Everything else that arrives empty gets
 * one from its title, because a page with no address cannot be linked to and a
 * silently unreachable page is worse than a clumsy address.
 */
export function cleanPage(raw: unknown, at: number): WebsitePage {
  const page = (raw ?? {}) as Record<string, unknown>;
  const title = line(page.title, 200) || `Page ${at + 1}`;

  const askedSlug = String(page.slug ?? "").trim().toLowerCase();
  const slug =
    at === 0
      ? ""
      : (askedSlug || title)
          .normalize("NFKD")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 60) || `page-${at + 1}`;

  const keywords = Array.isArray(page.keywords)
    ? page.keywords.map((k) => line(k, 80)).filter(Boolean).slice(0, 20)
    : [];

  return {
    slug,
    title,
    metaTitle: line(page.metaTitle, 120),
    metaDescription: line(page.metaDescription, 300),
    bodyHtml: String(page.bodyHtml ?? "").slice(0, MAX_BODY),
    keywords,
    order: at,
  };
}

export function cleanPages(raw: unknown): WebsitePage[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.slice(0, MAX_PAGES).map((page, at) => cleanPage(page, at));
}
