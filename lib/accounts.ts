import { readFileSync, writeFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

import {
  encodeUsers,
  everyUser,
  putStoredUsers,
  refresh,
  storedUsers,
  type AppUser,
} from "./users";

// No look-alike characters: someone will retype this from a screen.
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePassword(length = 20): string {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

/** Same shape the CLI enforces, so both routes to an account agree. */
export function validateUsername(raw: string): string | null {
  const username = raw.trim().replace(/\s+/g, " ").toLowerCase();
  if (!/^[a-z0-9][a-z0-9._ -]{0,30}[a-z0-9]$/.test(username)) return null;
  return username;
}

export type AddResult = {
  username: string;
  password: string;
  /** The complete AUTH_USERS value, for pasting wherever this is deployed. */
  authUsers: string;
  /** True when the account was saved somewhere, rather than only returned. */
  persisted: boolean;
  /**
   * Which of the three it was. The page needs this rather than persisted
   * alone: an account in the store needs nothing pasted anywhere, one written
   * to a local file still does for every other environment.
   */
  where: "store" | "file" | "nowhere";
  note: string;
};

/**
 * Adding somebody, in the order of what actually persists.
 *
 * The store first. That is where the rest of this app's state lives, every
 * instance reads the same one, and an account written there works on the next
 * request with no deployment involved — which is the whole point, because
 * pasting a value into a dashboard and redeploying to add a colleague is not
 * something anybody should have to do twice.
 *
 * Then .env.local, for running this on a laptop where there is no store.
 *
 * Only if neither can hold it is the value handed back to paste, which is the
 * old behaviour kept for the case where it is the only thing left.
 */
export async function addAccount(
  usernameRaw: string,
  passwordRaw: string | null
): Promise<AddResult | { error: string }> {
  const username = validateUsername(usernameRaw);
  if (!username) {
    return {
      error:
        "Use 2 to 32 characters, starting and ending with a letter or digit. Letters, digits, spaces, dots, underscores and hyphens between.",
    };
  }

  const password = passwordRaw && passwordRaw.length ? passwordRaw : generatePassword();
  if (password.length < 10) {
    return { error: "Password must be at least 10 characters." };
  }

  let current: AppUser[];
  try {
    current = await everyUser();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not read the account list.",
    };
  }

  if (current.some((u) => u.username === username)) {
    return { error: `An account called "${username}" already exists.` };
  }

  // Cost 12: a few hundred ms, which makes cracking a leaked hash expensive
  // while staying invisible at sign-in.
  const passwordHash = await bcrypt.hash(password, 12);
  const next = [...current, { username, passwordHash }];
  const authUsers = encodeUsers(next);

  // Where it belongs, if there is one. Only the accounts added here are stored;
  // the seed stays in the environment, untouched, so a store that is empty or
  // unreachable still leaves somebody able to sign in.
  try {
    const kept = await storedUsers();
    if (await putStoredUsers([...kept, { username, passwordHash }])) {
      return {
        username,
        password,
        authUsers,
        persisted: true,
        where: "store",
        note:
          "Saved. The account works everywhere this platform runs, from the " +
          "next sign-in. Nothing to paste and nothing to redeploy.",
      };
    }
  } catch {
    // Fall through to the file, then to the paste. A store that did not take
    // the write is not a reason to lose the account somebody just made.
  }

  let persisted = false;
  try {
    const path = ".env.local";
    const lines = readFileSync(path, "utf8").split(/\r?\n/);
    const at = lines.findIndex((l) => l.startsWith("AUTH_USERS="));
    const line = "AUTH_USERS=" + authUsers;
    if (at === -1) lines.push(line);
    else lines[at] = line;
    writeFileSync(path, lines.join("\n"), "utf8");

    // The file is read at boot, so update the live value and drop the cache;
    // otherwise the new account would not work until a restart.
    process.env.AUTH_USERS = authUsers;
    refresh();
    persisted = true;
  } catch {
    persisted = false;
  }

  return {
    username,
    password,
    authUsers,
    persisted,
    where: persisted ? "file" : "nowhere",
    note: persisted
      ? "Written to .env.local and live on this instance. Update AUTH_USERS wherever else this runs, then redeploy."
      : "This environment has a read-only filesystem, so nothing was saved. Set AUTH_USERS to the value below and redeploy.",
  };
}

/** Usernames only. Hashes never leave the server. */
export async function listAccounts(): Promise<string[]> {
  return (await everyUser()).map((u) => u.username);
}
