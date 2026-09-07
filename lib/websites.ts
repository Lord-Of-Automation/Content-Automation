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
  note: string;
  pages: WebsitePage[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
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
  return [...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getWebsite(id: string): Promise<Website | null> {
  return (await read()).find((w) => w.id === id) ?? null;
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
  site: {
    name?: string;
    tagline?: string;
    language?: string;
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
  if (!built?.site) return site;

  const pages = cleanPages(built.site.pages);
  const ended = runEnded(built.status);

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

  return {
    ...site,
    name: site.name || String(built.site.name ?? ""),
    tagline: String(built.site.tagline ?? "") || site.tagline,
    language: String(built.site.language ?? "") || site.language,
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
