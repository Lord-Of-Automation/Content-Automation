import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { kvConfigured, kvGetJSON, kvSetJSON } from "./kv";
import { adminUser } from "./actor";
import { DEFAULT_PERMISSIONS, EVERY_PERMISSION } from "./permissionlist";

/**
 * Who has which permissions.
 *
 * The list itself is next door, in a file with no filesystem in it, because
 * the page that grants these has to be able to read the list and cannot read
 * this.
 */

const KEY = "content-automation:permissions";
const DIR = path.join(process.cwd(), ".data");
const FILE = path.join(DIR, "permissions.json");

/** Username to the permissions they were given. Absent means the default set. */
type Store = Record<string, string[]>;

async function read(): Promise<Store> {
  if (kvConfigured()) {
    const row = await kvGetJSON<Store>(KEY);
    if (row && typeof row === "object") return row;
  }
  try {
    if (existsSync(FILE)) {
      const parsed = JSON.parse(readFileSync(FILE, "utf8")) as Store;
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {
    // A corrupt file is everybody on the default set, not a platform nobody
    // can sign in to.
  }
  return {};
}

async function write(store: Store): Promise<void> {
  if (kvConfigured()) {
    if (await kvSetJSON(KEY, store)) return;
    throw new Error("The store did not accept the write, so nothing was saved.");
  }
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(store, null, 2), "utf8");
}

function tidy(user: string): string {
  return String(user ?? "").trim().toLowerCase();
}

/**
 * What one account may do.
 *
 * The admin has everything, and it is not stored: the admin is named in the
 * environment and the point of that account is that it can always get back in.
 * Saving its permissions would mean a wrong click locking the platform's
 * owner out of the page that fixes wrong clicks.
 */
export async function permissionsOf(user: string): Promise<string[]> {
  const who = tidy(user);
  if (!who) return [];

  /*
   * Nothing is restricted until somebody is in charge.
   *
   * With no ADMIN_USER named, nobody holds the permission to grant
   * permissions — and the default set deliberately does not include it, so
   * there is no way to grant it to anybody either. That is a locked door with
   * the key inside: a platform that was working yesterday would refuse its own
   * owner the page that fixes it, and refuse it in a way that reads as a bug.
   *
   * So the whole thing is inert until an admin exists. Naming one is what
   * switches it on, which is also the honest description of what naming one
   * does — before that there is nobody to be restricted on behalf of.
   */
  const admin = adminUser();
  if (!admin) return [...EVERY_PERMISSION];

  if (who === admin) return [...EVERY_PERMISSION];

  const store = await read();
  return store[who] ?? [...DEFAULT_PERMISSIONS];
}

/** Whether this account may do one particular thing. */
export async function may(user: string, permission: string): Promise<boolean> {
  return (await permissionsOf(user)).includes(permission);
}

/** Everything the page needs: who exists, and what each of them may do. */
export async function permissionsFor(users: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const user of users) out[user] = await permissionsOf(user);
  return out;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function setPermissions(user: string, granted: string[]): Promise<SaveResult> {
  const who = tidy(user);
  if (!who) return { ok: false, error: "No account was named." };

  const admin = adminUser();
  if (!admin) {
    return {
      ok: false,
      error:
        "No admin account is named, so permissions are not in force and there " +
        "is nothing to save. Set ADMIN_USER to a username on this console, " +
        "redeploy, and everybody else drops to the default set.",
    };
  }
  if (who === admin) {
    return {
      ok: false,
      error:
        "The admin account's permissions are set by ADMIN_USER and cannot be " +
        "edited here. That is what makes it the account that can always get " +
        "back in.",
    };
  }

  // Unknown names are dropped rather than refused. A permission removed from
  // the list above should not make every saved account unsaveable.
  const kept = [...new Set(granted.map(String).filter((one) => EVERY_PERMISSION.includes(one)))];

  const store = await read();
  store[who] = kept;
  await write(store);
  return { ok: true };
}
