/**
 * Named groups of domains.
 *
 * Four hundred domains is too many to hold in your head, and the useful
 * divisions are not ones any registrar knows about: which brand a domain
 * belongs to, which server it points at, which project is using it. None of
 * that is derivable from the name or the expiry date, so it is written down
 * here.
 *
 * A domain may be in several groups. That is the point rather than a compromise
 * — a domain can belong to one brand and one server at the same time, and
 * forcing a single label would mean choosing which of those questions the list
 * is allowed to answer.
 *
 * Nothing here is a secret, so it is stored in the clear beside the schedules
 * rather than through the credential store.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { kvConfigured, kvGetJSON, kvSetJSON } from "./kv";

const KEY = "content-automation:domaingroups";
const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "domaingroups.json");

export interface DomainGroup {
  id: string;
  name: string;
  /** Lower-cased domain names. Order is how they were added. */
  domains: string[];
  updatedAt: string;
  updatedBy: string;
}

/** Enough to be useful, few enough that the list stays a list. */
const MAX_GROUPS = 60;
const MAX_PER_GROUP = 2000;

async function read(): Promise<DomainGroup[]> {
  if (kvConfigured()) {
    const rows = await kvGetJSON<DomainGroup[]>(KEY);
    if (Array.isArray(rows)) return rows;
  }
  try {
    if (existsSync(FILE)) {
      const parsed = JSON.parse(readFileSync(FILE, "utf8")) as DomainGroup[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // A corrupt file reads as no groups rather than taking the page down.
  }
  return [];
}

async function write(groups: DomainGroup[]): Promise<void> {
  if (kvConfigured()) {
    if (await kvSetJSON(KEY, groups)) return;
    throw new Error("The store did not accept the write, so nothing was saved.");
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(groups, null, 2), "utf8");
}

export async function listDomainGroups(): Promise<DomainGroup[]> {
  return [...(await read())].sort((a, b) => a.name.localeCompare(b.name));
}

export type GroupResult =
  | { ok: true; id: string; name: string; added: number; already: number }
  | { ok: false; error: string };

function clean(domains: string[]): string[] {
  const out = new Set<string>();
  for (const d of domains) {
    const name = String(d ?? "").trim().toLowerCase();
    if (/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(name)) out.add(name);
  }
  return [...out];
}

/**
 * Adds domains to a group, making it if it does not exist.
 *
 * Appending rather than replacing, because that is what selecting more domains
 * and choosing a group means. Replacing would make adding one domain to a group
 * of two hundred an act of deletion, which is not a thing anybody would expect
 * from a menu called Group.
 */
export async function addToGroup(
  options: { id?: string; name?: string; domains: string[] },
  actor: string,
): Promise<GroupResult> {
  const domains = clean(options.domains ?? []);
  if (!domains.length) return { ok: false, error: "No usable domains in that selection." };

  const groups = await read();

  let group = options.id ? groups.find((g) => g.id === options.id) : undefined;

  if (!group) {
    const name = String(options.name ?? "").trim();
    if (!name) return { ok: false, error: "The group needs a name." };
    if (name.length > 60) return { ok: false, error: "That name is too long to read in a list." };

    // Matched on the name as well as the id, so choosing "New group" and typing
    // one that exists adds to it rather than making a second group with the
    // same name that nobody could tell apart afterwards.
    group = groups.find((g) => g.name.toLowerCase() === name.toLowerCase());

    if (!group) {
      if (groups.length >= MAX_GROUPS) {
        return { ok: false, error: `That is already ${MAX_GROUPS} groups, which is as many as this holds.` };
      }
      group = {
        id: `dg${Date.now().toString(36)}`,
        name,
        domains: [],
        updatedAt: "",
        updatedBy: "",
      };
      groups.push(group);
    }
  }

  const before = new Set(group.domains);
  const added = domains.filter((d) => !before.has(d));

  if (group.domains.length + added.length > MAX_PER_GROUP) {
    return { ok: false, error: "That would put more domains in one group than it holds." };
  }

  group.domains = [...group.domains, ...added];
  group.updatedAt = new Date().toISOString();
  group.updatedBy = actor;

  await write(groups);
  return {
    ok: true,
    id: group.id,
    name: group.name,
    added: added.length,
    already: domains.length - added.length,
  };
}

/** Takes domains out of one group. The group stays, even when it empties. */
export async function removeFromGroup(
  id: string,
  domains: string[],
  actor: string,
): Promise<GroupResult> {
  const groups = await read();
  const group = groups.find((g) => g.id === id);
  if (!group) return { ok: false, error: "No such group." };

  const drop = new Set(clean(domains));
  const before = group.domains.length;
  group.domains = group.domains.filter((d) => !drop.has(d));
  group.updatedAt = new Date().toISOString();
  group.updatedBy = actor;

  await write(groups);
  return {
    ok: true,
    id: group.id,
    name: group.name,
    added: 0,
    already: before - group.domains.length,
  };
}

/** Forgets a group. The domains themselves are untouched. */
export async function deleteDomainGroup(id: string): Promise<void> {
  const groups = await read();
  await write(groups.filter((g) => g.id !== id));
}

/** Which groups each domain is in, for the table. Keyed by domain. */
export async function groupsByDomain(): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const group of await read()) {
    for (const domain of group.domains) {
      (out[domain] ??= []).push(group.name);
    }
  }
  return out;
}
