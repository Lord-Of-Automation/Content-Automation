/**
 * Named sets of DNS records, so adding a domain to Cloudflare is one choice.
 *
 * Every site in an estate like this points at one of a handful of servers, and
 * the records that send it there are the same every time: an A record at the
 * apex, a CNAME for www, sometimes mail. Typing those four lines correctly for
 * the four hundredth domain is where the mistakes come from, and a mistyped A
 * record is a site that serves somebody else's page.
 *
 * So they are saved once, under a name somebody recognises — "UK server", "One
 * page server", "Hostinger" — and picked from a list. The records themselves
 * are held here rather than on Cloudflare because they exist before any zone
 * does: the whole point is to have them ready at the moment a zone is created.
 *
 * Nothing here is secret. A server's address is public the moment the site
 * resolves, so this is stored in the clear beside the schedules rather than
 * through the credential store.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { kvConfigured, kvGetJSON, kvSetJSON } from "./kv";

const KEY = "content-automation:dnsgroups";
const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "dnsgroups.json");

export interface GroupRecord {
  type: string;
  /** "@" for the domain itself, or a label. Never the full name. */
  name: string;
  content: string;
  ttl: number;
  /** Whether Cloudflare stands in front of it. */
  proxied: boolean;
  priority?: number;
}

export interface DnsGroup {
  id: string;
  name: string;
  records: GroupRecord[];
  updatedAt: string;
  updatedBy: string;
}

const ALLOWED = ["A", "AAAA", "CNAME", "MX", "TXT", "CAA"];

/**
 * What a new installation starts with.
 *
 * Not a guess at anybody's servers, which would be worse than nothing: a
 * plausible wrong address is one somebody accepts without checking. It is the
 * shape of a group, with the address left obviously blank so it has to be
 * filled in before it can be used.
 */
export const STARTER: DnsGroup[] = [
  {
    id: "example",
    name: "Example — edit or delete me",
    records: [
      { type: "A", name: "@", content: "", ttl: 1, proxied: true },
      { type: "CNAME", name: "www", content: "@", ttl: 1, proxied: true },
    ],
    updatedAt: "",
    updatedBy: "",
  },
];

async function read(): Promise<DnsGroup[]> {
  if (kvConfigured()) {
    const rows = await kvGetJSON<DnsGroup[]>(KEY);
    if (Array.isArray(rows)) return rows;
  }
  try {
    if (existsSync(FILE)) {
      const parsed = JSON.parse(readFileSync(FILE, "utf8")) as DnsGroup[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // A corrupt file reads as no groups rather than taking the page down.
  }
  return [];
}

async function write(groups: DnsGroup[]): Promise<void> {
  if (kvConfigured()) {
    if (await kvSetJSON(KEY, groups)) return;
    throw new Error("The store did not accept the write, so nothing was saved.");
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(groups, null, 2), "utf8");
}

export async function listGroups(): Promise<DnsGroup[]> {
  const groups = await read();
  return [...groups].sort((a, b) => a.name.localeCompare(b.name));
}

export type SaveGroup = { ok: true; id: string } | { ok: false; error: string };

function checkRecord(record: GroupRecord, at: number): string | null {
  const type = String(record.type ?? "").toUpperCase();
  if (!ALLOWED.includes(type)) return `Row ${at + 1}: ${type || "that"} is not a record type.`;
  if (!String(record.name ?? "").trim()) return `Row ${at + 1}: a record needs a name.`;
  if (!String(record.content ?? "").trim()) {
    return `Row ${at + 1}: a record needs a value. A group with a blank address would point every domain that used it at nothing.`;
  }
  if (type === "A" && !/^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(record.content.trim())) {
    return `Row ${at + 1}: an A record takes an IPv4 address.`;
  }
  if (type === "MX" && (record.priority === undefined || !Number.isFinite(record.priority))) {
    return `Row ${at + 1}: an MX record needs a priority.`;
  }
  return null;
}

export async function saveGroup(
  group: { id?: string; name: string; records: GroupRecord[] },
  actor: string,
): Promise<SaveGroup> {
  const name = String(group.name ?? "").trim();
  if (!name) return { ok: false, error: "The group needs a name." };
  if (!Array.isArray(group.records) || !group.records.length) {
    return { ok: false, error: "A group with no records would do nothing." };
  }
  if (group.records.length > 40) {
    return { ok: false, error: "That is more records than a group should hold." };
  }

  for (let at = 0; at < group.records.length; at += 1) {
    const problem = checkRecord(group.records[at], at);
    if (problem) return { ok: false, error: problem };
  }

  const groups = await read();
  // A stable id so a group can be renamed without every domain that used it
  // losing track of which one it was.
  const id = group.id?.trim() || `g${Date.now().toString(36)}`;
  const entry: DnsGroup = {
    id,
    name,
    records: group.records.map((r) => ({
      type: r.type.toUpperCase(),
      name: String(r.name).trim(),
      content: String(r.content).trim(),
      ttl: Number(r.ttl) || 1,
      proxied: r.proxied === true,
      ...(r.priority === undefined ? {} : { priority: Number(r.priority) }),
    })),
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  };

  const at = groups.findIndex((g) => g.id === id);
  if (at >= 0) groups[at] = entry;
  else groups.push(entry);

  await write(groups);
  return { ok: true, id };
}

export async function deleteGroup(id: string): Promise<void> {
  const groups = await read();
  await write(groups.filter((g) => g.id !== id));
}

export async function groupById(id: string): Promise<DnsGroup | null> {
  return (await read()).find((g) => g.id === id) ?? null;
}
