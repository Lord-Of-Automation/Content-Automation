/**
 * The GoDaddy token, stored here rather than in the environment.
 *
 * It began as GODADDY_API_KEY on the deployment, which is fine for one operator
 * and wrong for everything else: changing it means a redeploy, and it cannot
 * differ between the people using the console. Kept here it is editable from
 * the Keys page and takes effect on the next request.
 *
 * Encrypted at rest with the same scheme as the WordPress logins. That matters
 * more here than there. GoDaddy issues these with account-wide scope — the same
 * token that lists domains can transfer them away — and there is no read-only
 * option to fall back on, so a dump of the store must not be a working
 * credential.
 *
 * The environment variable still works and is the fallback, so nothing breaks
 * on a deployment that has not moved over.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { kvConfigured, kvGetJSON, kvSetJSON } from "./kv";
import { decrypt, encrypt } from "./secrets";

const KEY = "content-automation:godaddy";
const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "godaddy.json");

type Stored = {
  /** Ciphertext. Never returned to the browser. */
  secret: string;
  /**
   * When the token stops working, as the person entering it read off GoDaddy.
   *
   * Typed in rather than discovered, because nothing in the API reports it. A
   * token simply starts answering 401 on its expiry date, and the first symptom
   * is a page that worked yesterday saying the credential is wrong — which
   * sends you to check a token that is exactly as you left it.
   */
  expiresAt: string | null;
  savedAt: string;
  savedBy: string;
};

/** What the browser may see. Never the token. */
export type GoDaddyKeyStatus = {
  set: boolean;
  source: "console" | "environment" | "unset";
  /** Last four characters, enough to tell two tokens apart and no more. */
  tail: string;
  expiresAt: string | null;
  /** Days until it expires, negative once past. Null when no date was given. */
  daysLeft: number | null;
  savedAt: string | null;
  savedBy: string | null;
  /** False when AUTH_SECRET changed and the stored token can no longer be read. */
  readable: boolean;
};

async function read(): Promise<Stored | null> {
  if (kvConfigured()) {
    const row = await kvGetJSON<Stored>(KEY);
    if (row?.secret) return row;
  }
  try {
    if (existsSync(FILE)) {
      const parsed = JSON.parse(readFileSync(FILE, "utf8")) as Stored;
      if (parsed?.secret) return parsed;
    }
  } catch {
    // A corrupt file falls back to the environment rather than taking the page
    // down. The console then says the key came from the environment, which is
    // true and is the thing worth knowing.
  }
  return null;
}

async function write(row: Stored | null): Promise<void> {
  if (kvConfigured()) {
    if (await kvSetJSON(KEY, row)) return;
    throw new Error(
      "The key store did not accept the write, so nothing was saved. " +
        "Check KV_REST_API_URL and KV_REST_API_TOKEN, then try again.",
    );
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(row, null, 2), "utf8");
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return Math.round((at - Date.now()) / 86_400_000);
}

/** What the Keys page shows. Never the token itself. */
export async function keyStatus(): Promise<GoDaddyKeyStatus> {
  const row = await read();

  if (row) {
    let tail = "";
    let readable = true;
    try {
      tail = decrypt(row.secret).slice(-4);
    } catch {
      readable = false;
    }
    return {
      set: true,
      source: "console",
      tail,
      expiresAt: row.expiresAt,
      daysLeft: daysUntil(row.expiresAt),
      savedAt: row.savedAt,
      savedBy: row.savedBy,
      readable,
    };
  }

  const fromEnv = process.env.GODADDY_API_KEY?.trim();
  if (fromEnv) {
    return {
      set: true,
      source: "environment",
      tail: fromEnv.slice(-4),
      expiresAt: null,
      daysLeft: null,
      savedAt: null,
      savedBy: null,
      readable: true,
    };
  }

  return {
    set: false,
    source: "unset",
    tail: "",
    expiresAt: null,
    daysLeft: null,
    savedAt: null,
    savedBy: null,
    readable: true,
  };
}

export type SaveKeyResult = { ok: true; tail: string } | { ok: false; error: string };

export async function saveKey(
  token: string,
  expiresAt: string,
  actor: string,
): Promise<SaveKeyResult> {
  const clean = String(token || "").trim();
  if (!clean) return { ok: false, error: "A token is required." };

  // Shape-checked rather than merely non-empty. Everything GoDaddy issues today
  // starts gd_pat_, and the commonest way to get this wrong is to paste the
  // whole "Authorization: Bearer ..." line, or the key id shown beside the
  // token instead of the token. A refusal here is far cheaper than a page that
  // says GoDaddy rejected the credential.
  if (!/^gd_pat_[A-Za-z0-9_-]{20,}$/.test(clean)) {
    return {
      ok: false,
      error:
        "That does not look like a GoDaddy Personal Access Token. " +
        "It should start with gd_pat_ and have no spaces. Paste the token itself, " +
        "not the whole Authorization header.",
    };
  }

  let when: string | null = null;
  if (expiresAt.trim()) {
    const at = Date.parse(expiresAt);
    if (!Number.isFinite(at)) return { ok: false, error: "That expiry date is not a date." };
    when = new Date(at).toISOString();
  }

  let secret: string;
  try {
    secret = encrypt(clean);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not encrypt." };
  }

  await write({
    secret,
    expiresAt: when,
    savedAt: new Date().toISOString(),
    savedBy: actor,
  });

  return { ok: true, tail: clean.slice(-4) };
}

/** Forgets the stored token, so the environment variable takes over again. */
export async function clearKey(): Promise<void> {
  await write(null);
}

/**
 * The token to actually call GoDaddy with.
 *
 * Stored first, environment second. Null when neither is set, which the caller
 * turns into a message about where to put one.
 */
export async function currentKey(): Promise<string | null> {
  const row = await read();
  if (row) {
    try {
      return decrypt(row.secret);
    } catch {
      // Unreadable is the same as absent: better to fall through to the
      // environment than to call GoDaddy with nonsense and report its 401 as
      // though the token were wrong.
      return process.env.GODADDY_API_KEY?.trim() || null;
    }
  }
  return process.env.GODADDY_API_KEY?.trim() || null;
}
