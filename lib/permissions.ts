import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { kvConfigured, kvGetJSON, kvSetJSON } from "./kv";
import { DEFAULT_PERMISSIONS, EVERY_PERMISSION, FULL_ACCESS } from "./permissionlist";
import { everyUser } from "./users";

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
 * The account named in the environment, if there is one.
 *
 * It is no longer the only way to be in charge — full access can be granted on
 * the accounts page now — but it stays because it is the one that survives a
 * store nobody can write to and a permissions edit that went wrong. An
 * environment variable cannot be changed by anybody holding a session.
 */
export function adminUser(): string {
  return tidy(process.env.ADMIN_USER ?? "");
}

/**
 * Whether anybody at all is in charge yet.
 *
 * This is what decides whether permissions mean anything. Somebody has to be
 * able to grant the first one, and the only account that can grant without
 * having been granted is one that already holds everything. So while nobody
 * holds full access, everybody does, and the first person to claim it is what
 * turns the restrictions on. No name in the environment, no command, no
 * redeploy.
 *
 * The same rule is what makes a lockout impossible in the other direction: an
 * admin who removes their own full access does not lock the platform, they
 * return it to the state where anybody can claim it again.
 */
async function anyoneInCharge(store: Store): Promise<boolean> {
  if (Object.values(store).some((granted) => granted.includes(FULL_ACCESS))) return true;

  /*
   * A name in the environment only counts if somebody can sign in as it.
   *
   * Setting ADMIN_USER to a name that is not an account is the easiest
   * mistake to make here, and it used to be the worst: the platform would
   * decide it was under management, drop everybody to the default set, and
   * wait to be rescued by an account that does not exist. The misconfiguration
   * and the lockout looked identical from the outside, which is what made it
   * expensive.
   */
  const named = adminUser();
  if (!named) return false;
  try {
    return (await everyUser()).some((one) => one.username === named);
  } catch {
    // No account list to check against is not a reason to enforce anything.
    return false;
  }
}

/**
 * Whether ADMIN_USER names somebody who cannot sign in.
 *
 * Worth saying out loud on the page, because the variable looks set and does
 * nothing, and the two are indistinguishable otherwise.
 */
export async function adminIsMissing(): Promise<boolean> {
  const named = adminUser();
  if (!named) return false;
  try {
    return !(await everyUser()).some((one) => one.username === named);
  } catch {
    return false;
  }
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
  if (who === adminUser()) return [...EVERY_PERMISSION];

  const store = await read();
  const granted = store[who];

  // Full access is not a permission that sits alongside the others, it is all
  // of them. Storing the list separately would let the two disagree.
  if (granted?.includes(FULL_ACCESS)) return [...EVERY_PERMISSION];

  // Nobody in charge means nothing is in force. See anyoneInCharge.
  if (!(await anyoneInCharge(store))) return [...EVERY_PERMISSION];

  return granted ?? [...DEFAULT_PERMISSIONS];
}

/**
 * Whether this account sees everybody's work rather than only its own.
 *
 * Asked on the way out to the engine, which keeps the work and has no way to
 * find this out for itself.
 */
export async function hasFullAccess(user: string): Promise<boolean> {
  const who = tidy(user);
  if (!who) return false;
  if (who === adminUser()) return true;
  return (await read())[who]?.includes(FULL_ACCESS) ?? false;
}

/** Whether this account may do one particular thing. */
export async function may(user: string, permission: string): Promise<boolean> {
  return (await permissionsOf(user)).includes(permission);
}

/**
 * What is set for one account, whether or not it is being enforced.
 *
 * Different from permissionsOf on purpose, and only in the one state where
 * nobody is in charge: there, everybody can do everything, but that is a
 * property of the platform rather than of the account. The page that edits
 * these needs the second answer — otherwise every box is ticked for everybody,
 * saving one account hands it full access by accident, and the badges say
 * Admin next to every name on a platform with no admin.
 */
export async function settingsOf(user: string): Promise<string[]> {
  const who = tidy(user);
  if (!who) return [];
  if (who === adminUser()) return [...EVERY_PERMISSION];

  const store = await read();
  return store[who] ?? [...DEFAULT_PERMISSIONS];
}

/** Whether anybody holds full access, so the lists mean something. */
export async function restrictionsApply(): Promise<boolean> {
  return anyoneInCharge(await read());
}

/** Everything the page needs: who exists, and what is set for each of them. */
export async function permissionsFor(users: string[]): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const user of users) out[user] = await settingsOf(user);
  return out;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function setPermissions(
  user: string,
  granted: string[],
  actor: string,
): Promise<SaveResult> {
  const who = tidy(user);
  if (!who) return { ok: false, error: "No account was named." };

  if (who === adminUser()) {
    return {
      ok: false,
      error:
        "This account is named as admin in the environment, so its permissions " +
        "are not editable here. That is what makes it the one that can always " +
        "get back in.",
    };
  }

  // Unknown names are dropped rather than refused. A permission removed from
  // the list above should not make every saved account unsaveable.
  const kept = [...new Set(granted.map(String).filter((one) => EVERY_PERMISSION.includes(one)))];

  const store = await read();
  const was =
    store[who] ?? ((await anyoneInCharge(store)) ? DEFAULT_PERMISSIONS : EVERY_PERMISSION);

  /*
   * Only somebody who already has full access can hand it out or take it back.
   *
   * Without this the Accounts permission quietly becomes full access: give
   * somebody the right to edit permissions and they tick the box for
   * themselves, and now they read everybody's mail. Those are two different
   * levels of trust and this is the line between them — managing people is
   * something you delegate, seeing everybody's work is not.
   */
  const changesFullAccess = was.includes(FULL_ACCESS) !== kept.includes(FULL_ACCESS);
  if (changesFullAccess && !(await hasFullAccess(actor))) {
    return {
      ok: false,
      error:
        "Full access can only be granted or withdrawn by somebody who already " +
        "has it. Everything else on this list you may change.",
    };
  }

  store[who] = kept;
  await write(store);
  return { ok: true };
}
