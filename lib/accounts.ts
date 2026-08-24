import { readFileSync, writeFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

import { encodeUsers, getUsers, refresh, type AppUser } from "./users";

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
  /** True when .env.local was updated and this instance already sees it. */
  persisted: boolean;
  note: string;
};

/**
 * Accounts live in AUTH_USERS, an environment variable, so there is nothing to
 * write to in the general case. Where the filesystem is writable, .env.local is
 * updated and the in-process cache is refreshed so the account works at once.
 * Where it is not, which is every serverless deployment, the caller is handed
 * the value to paste. Either way the new value is returned, because the local
 * file is not the source of truth for a deployment.
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
    current = getUsers();
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not read AUTH_USERS.",
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
    note: persisted
      ? "Written to .env.local and live on this instance. Update AUTH_USERS wherever else this runs, then redeploy."
      : "This environment has a read-only filesystem, so nothing was saved. Set AUTH_USERS to the value below and redeploy.",
  };
}

/** Usernames only. Hashes never leave the server. */
export function listAccounts(): string[] {
  return getUsers().map((u) => u.username);
}
