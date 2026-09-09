/**
 * Earlier versions of a website, and the way back to one.
 *
 * Editing is the point of this part of the console: somebody reads what the AI
 * wrote and fixes it. Which means somebody also, eventually, breaks it — pastes
 * over a page, deletes a section they wanted, spends an hour making it worse.
 * Until now the only version that existed was the current one, so all of that
 * was permanent the moment it was saved.
 *
 * So every save keeps the version it replaced. What is stored is a prior state,
 * not the current one: the current site is already the site, and storing it
 * twice would mean the two could disagree.
 *
 * Restoring is itself a save, so it keeps a version too. Going back is
 * therefore undoable, which matters more than it sounds: the common way to lose
 * work with a revision system is to restore the wrong one.
 *
 * ---
 *
 * Kept per site rather than all together. A single blob would be read and
 * rewritten in full every time anybody saved anything, and would grow with
 * every site in the console rather than with the one being edited.
 *
 * And bounded twice, by count and by size. A revision is a whole copy of a
 * site, so an afternoon of small edits to a large site is a large amount of
 * storage bought one save at a time, which is exactly how storage problems
 * arrive unnoticed. Old versions are dropped rather than kept forever, because
 * the value of a revision falls away sharply with age: the one you want is
 * almost always the one from twenty minutes ago.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { kvConfigured, kvGetJSON, kvSetJSON } from "./kv";
import type {
  SiteDesign, SiteFooter, SiteHeader, SiteTheme, Website, WebsitePage,
} from "./websites";

const DIR = path.join(process.cwd(), ".data", "website-revisions");

function keyFor(id: string): string {
  return `content-automation:website-revisions:${id}`;
}

function fileFor(id: string): string {
  return path.join(DIR, `${id}.json`);
}

/**
 * Enough to cover a day's work, few enough to stay a list you can read.
 *
 * WordPress keeps every revision forever unless told otherwise, which is why
 * the first thing anybody learns about WordPress revisions is how to turn them
 * off.
 */
export const MAX_REVISIONS = 25;

/** And a ceiling in bytes, since a site's size is not something we choose. */
const MAX_BYTES = 4_000_000;

/**
 * A site's editable content, and nothing else.
 *
 * Not the brief, the topic, the run that wrote it or when it was created:
 * those are the record of how the site was made, they are not editable, and
 * restoring an old version must not rewrite the site's own history.
 */
export interface RevisionBody {
  name: string;
  tagline: string;
  pages: WebsitePage[];
  header: SiteHeader;
  footer: SiteFooter;
  theme: SiteTheme;
  design: SiteDesign | null;
}

export interface Revision {
  id: string;
  /** When this version was made, not when it was replaced. */
  at: string;
  /** Who made it. */
  by: string;
  /** How it came to exist: somebody's edit, a restore, or the build itself. */
  /**
   * What replaced this version.
   *
   * "claude" is separate from "edit" because it is the one worth finding again
   * in a hurry. An edit somebody made by hand they remember making; an edit
   * they described in a sentence and watched happen is the one they may want
   * to walk back, and a list where it looks like every other save makes that
   * harder than it needs to be.
   */
  reason: "build" | "edit" | "restore" | "claude";
  body: RevisionBody;
}

/** A revision as the list shows it: everything except the site inside it. */
export interface RevisionSummary {
  id: string;
  at: string;
  by: string;
  reason: Revision["reason"];
  pages: number;
  /** What the next version changed. Empty on the newest, which changed nothing yet. */
  changed: string[];
}

export function newRevisionId(): string {
  return `rev-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** The editable part of a site, detached from it. */
export function snapshot(site: Website): RevisionBody {
  return {
    name: site.name,
    tagline: site.tagline,
    pages: site.pages,
    header: site.header,
    footer: site.footer,
    theme: site.theme,
    design: site.design,
  };
}

/**
 * Whether two versions differ in anything a person could have typed.
 *
 * Compared as JSON rather than field by field. It is exact, it cannot forget a
 * field somebody adds later, and the alternative — a comparison that misses the
 * one field that changed — produces the worst possible outcome here, which is a
 * revision list that quietly does not contain the edit you are looking for.
 */
export function sameContent(a: RevisionBody, b: RevisionBody): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function read(id: string): Promise<Revision[]> {
  if (kvConfigured()) {
    const rows = await kvGetJSON<Revision[]>(keyFor(id));
    if (Array.isArray(rows)) return rows;
  }
  try {
    const file = fileFor(id);
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Revision[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // Unreadable history reads as no history. It is a convenience, and taking
    // the editor down to protect it would be the wrong way round.
  }
  return [];
}

async function write(id: string, rows: Revision[]): Promise<void> {
  // Newest first, then trimmed from the old end by count and then by size.
  let kept = [...rows]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, MAX_REVISIONS);

  while (kept.length > 1 && JSON.stringify(kept).length > MAX_BYTES) {
    kept = kept.slice(0, -1);
  }

  if (kvConfigured()) {
    await kvSetJSON(keyFor(id), kept);
    return;
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(fileFor(id), JSON.stringify(kept, null, 2), "utf8");
}

/**
 * Keep the version being replaced.
 *
 * Given the site as it stands before a save. Does nothing when the content is
 * identical to the newest version already kept, so saving twice without
 * changing anything does not fill the list with copies.
 *
 * The first version kept for a site is labelled as the build's, whatever the
 * caller says, because a site with no history yet has had nothing done to it:
 * what is being kept is the site as the AI wrote it. That cannot be worked out
 * from the record itself — a build stamps its own name and time on the site
 * exactly as an edit would — but it can be worked out from here, where whether
 * anything came before is already known.
 */
export async function keepRevision(
  site: Website,
  reason: Exclude<Revision["reason"], "build">,
): Promise<void> {
  const body = snapshot(site);
  const rows = await read(site.id);
  if (rows.length && sameContent(rows[0]!.body, body)) return;

  rows.unshift({
    id: newRevisionId(),
    at: site.updatedAt || site.createdAt,
    by: site.updatedBy || site.createdBy,
    reason: rows.length ? reason : "build",
    body,
  });
  await write(site.id, rows);
}

export async function listRevisions(id: string): Promise<Revision[]> {
  const rows = await read(id);
  return [...rows].sort((a, b) => b.at.localeCompare(a.at));
}

export async function getRevision(id: string, revision: string): Promise<Revision | null> {
  return (await read(id)).find((r) => r.id === revision) ?? null;
}

export async function dropRevisions(id: string): Promise<void> {
  if (kvConfigured()) {
    await kvSetJSON(keyFor(id), []);
    return;
  }
  try {
    const file = fileFor(id);
    if (existsSync(file)) writeFileSync(file, "[]", "utf8");
  } catch {
    // The site is gone either way; a stranded history file is not worth an error.
  }
}

/**
 * What changed between two versions, in words.
 *
 * A list of sentences rather than a diff. A diff of HTML is a wall of tags, and
 * the question being asked of a revision list is "which one was before I broke
 * the pricing page", which a sentence answers and a diff buries.
 *
 * Named for what it describes: the change that happened *after* `older`, which
 * is what restoring `older` would undo.
 */
export function describeChange(older: RevisionBody, newer: RevisionBody): string[] {
  const changes: string[] = [];

  if (older.name !== newer.name) {
    changes.push(`Renamed to ${newer.name}`);
  }
  if (older.tagline !== newer.tagline) {
    changes.push(newer.tagline ? "Tagline changed" : "Tagline removed");
  }

  const was = new Map(older.pages.map((p) => [p.slug, p] as const));
  const now = new Map(newer.pages.map((p) => [p.slug, p] as const));

  const added = newer.pages.filter((p) => !was.has(p.slug));
  const removed = older.pages.filter((p) => !now.has(p.slug));
  for (const page of added) changes.push(`Added ${page.title || page.slug || "the front page"}`);
  for (const page of removed) changes.push(`Removed ${page.title || page.slug || "the front page"}`);

  for (const page of newer.pages) {
    const before = was.get(page.slug);
    if (!before) continue;

    const parts: string[] = [];
    if (before.bodyHtml !== page.bodyHtml) parts.push("content");
    if (before.title !== page.title) parts.push("title");
    if (before.metaTitle !== page.metaTitle || before.metaDescription !== page.metaDescription) {
      parts.push("meta");
    }
    if (parts.length) {
      changes.push(`${page.title || "Front page"}: ${parts.join(", ")}`);
    }
  }

  if (JSON.stringify(older.header) !== JSON.stringify(newer.header)) changes.push("Header");
  if (JSON.stringify(older.footer) !== JSON.stringify(newer.footer)) changes.push("Footer");
  if (JSON.stringify(older.theme) !== JSON.stringify(newer.theme)) changes.push("Colours");
  if (JSON.stringify(older.design) !== JSON.stringify(newer.design)) changes.push("Design");

  return changes;
}

/**
 * The list as the editor shows it, newest first, each row saying what the
 * version after it changed.
 *
 * `current` is the site as it stands, which is not stored as a revision but is
 * what the newest revision has to be compared against — otherwise the top row,
 * the one nearly always wanted, is the only one with nothing to say.
 */
export function summarise(rows: Revision[], current: RevisionBody): RevisionSummary[] {
  return rows.map((row, at) => ({
    id: row.id,
    at: row.at,
    by: row.by,
    reason: row.reason,
    pages: row.body.pages.length,
    changed: describeChange(row.body, at === 0 ? current : rows[at - 1]!.body),
  }));
}
