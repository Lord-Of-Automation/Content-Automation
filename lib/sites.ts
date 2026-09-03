/**
 * WordPress logins, one per domain, so a run against any site can publish
 * without someone pasting credentials into the form each time.
 *
 * Passwords are encrypted at rest and never leave this module in the clear
 * except through credentialsFor(), which the run trigger calls.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { kvConfigured, kvGetJSON, kvSetJSON } from "./kv";
import { decrypt, encrypt } from "./secrets";

const KEY = "content-automation:sites";
const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "sites.json");

export type StoredSite = {
  domain: string;
  username: string;
  /** Ciphertext. Never returned to the browser. */
  secret: string;
  createdAt: string;
  createdBy: string;
};

/** What the browser is allowed to see. */
export type SiteSummary = {
  domain: string;
  username: string;
  createdAt: string;
  createdBy: string;
  /** False when AUTH_SECRET changed and the stored password can no longer be read. */
  readable: boolean;
};

/**
 * Compared on the registered domain, so one entry covers every page on a site.
 * www is dropped because it is the same login either way.
 */
export function normaliseDomain(input: string): string | null {
  const raw = String(input || "").trim();
  if (!raw) return null;

  let host = raw;
  try {
    host = new URL(raw.includes("://") ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }

  host = host.toLowerCase().replace(/^www\./, "");
  // A hostname needs a dot and no spaces or slashes to be worth storing.
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return null;
  return host;
}

async function readAll(): Promise<StoredSite[]> {
  if (kvConfigured()) {
    const rows = await kvGetJSON<StoredSite[]>(KEY);
    if (rows) return rows;
  }
  try {
    if (existsSync(FILE)) {
      const parsed = JSON.parse(readFileSync(FILE, "utf8")) as StoredSite[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // A corrupt file reads as empty rather than taking the page down.
  }
  return [];
}

async function writeAll(rows: StoredSite[]): Promise<void> {
  if (kvConfigured()) {
    // A failed write is not something to shrug at here. kvSetJSON swallows its
    // own errors because most of what goes through it is a cache, but this is
    // the store of record for site logins — and the early return meant an
    // unreachable KV lost the password while the console said it was saved.
    // The next run then failed to publish with a 401 nobody could account for.
    if (await kvSetJSON(KEY, rows)) return;
    throw new Error(
      "The key store did not accept the write, so nothing was saved. " +
        "Check KV_REST_API_URL and KV_REST_API_TOKEN, then try again.",
    );
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(rows, null, 2), "utf8");
}

/**
 * Strip what a copied password brings with it.
 *
 * WordPress prints an application password as "abcd EFGH ijkl MNOP", and
 * copying it off that screen routinely picks up a trailing space or newline.
 * Those go into the Basic auth header verbatim and the site rejects the login,
 * while the same password typed by hand works — so it looks like the wrong
 * password rather than a stray character.
 *
 * The interior spaces stay: they are part of the format WordPress prints and it
 * accepts them. What does not stay is a space that only looks like one.
 *
 * One function now, because there used to be two copies and they had drifted.
 * Both were written with the invisible character sitting in the pattern
 * literally; on the read path something normalised it into an ordinary space,
 * leaving a rule that replaced a space with a space and did nothing at all. So
 * a password saved before any of this existed was cleaned on the way in but not
 * on the way out — which is the one case the read path was added for. Escapes
 * survive being reformatted, and an invisible character never will.
 */
function tidyPassword(input: string): string {
  return input
    // No-break space, narrow no-break space, and the typographic spaces that
    // come from copying rendered HTML. All meant to be an ordinary space.
    .replace(/[\u00a0\u202f\u2000-\u200a\u2028\u2029\u3000]/g, " ")
    // Zero-width characters and the byte-order mark carry no width at all, so
    // they cannot be seen in the field and must simply go.
    .replace(/[\u200b\u200c\u200d\u2060\ufeff]/g, "")
    .trim();
}

export async function listSites(): Promise<SiteSummary[]> {
  const rows = await readAll();
  return rows
    .map((row) => ({
      domain: row.domain,
      username: row.username,
      createdAt: row.createdAt,
      createdBy: row.createdBy,
      readable: (() => {
        try {
          decrypt(row.secret);
          return true;
        } catch {
          return false;
        }
      })(),
    }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
}

export type SaveResult =
  | { ok: true; domain: string; replaced: boolean }
  | { ok: false; error: string };

export async function saveSite(
  domainInput: string,
  username: string,
  password: string,
  actor: string
): Promise<SaveResult> {
  const domain = normaliseDomain(domainInput);
  if (!domain) {
    return { ok: false, error: "That is not a domain. Use example.com." };
  }
  if (!username.trim()) {
    return { ok: false, error: "A WordPress username is required." };
  }
  if (!password || !password.trim()) {
    return { ok: false, error: "A password is required." };
  }

  const cleanPassword = tidyPassword(password);

  let secret: string;
  try {
    secret = encrypt(cleanPassword);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Could not encrypt.",
    };
  }

  const rows = await readAll();
  const existing = rows.findIndex((r) => r.domain === domain);
  const entry: StoredSite = {
    domain,
    username: username.trim(),
    secret,
    // Re-saving a domain keeps when it was first added, which is the useful date.
    createdAt: existing >= 0 ? rows[existing].createdAt : new Date().toISOString(),
    createdBy: existing >= 0 ? rows[existing].createdBy : actor,
  };

  if (existing >= 0) rows[existing] = entry;
  else rows.push(entry);

  await writeAll(rows);
  return { ok: true, domain, replaced: existing >= 0 };
}

export async function deleteSite(domainInput: string): Promise<boolean> {
  const domain = normaliseDomain(domainInput);
  if (!domain) return false;

  const rows = await readAll();
  const next = rows.filter((r) => r.domain !== domain);
  if (next.length === rows.length) return false;

  await writeAll(next);
  return true;
}

/**
 * The decrypted login for a URL, or null when the site is not registered.
 * Called when starting a run, so the workflow is handed the right credentials.
 */
export async function credentialsFor(
  url: string
): Promise<{ domain: string; username: string; password: string } | null> {
  const domain = normaliseDomain(url);
  if (!domain) return null;

  const rows = await readAll();
  const match = rows.find((r) => r.domain === domain);
  if (!match) return null;

  try {
    return {
      domain,
      username: match.username.trim(),
      // Cleaned on the way out as well as in, so an entry saved before this
      // existed does not need re-typing to start working.
      password: tidyPassword(decrypt(match.secret)),
    };
  } catch {
    // Unreadable is the same as absent: better no credentials than wrong ones.
    return null;
  }
}
