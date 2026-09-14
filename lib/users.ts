/**
 * Who can sign in.
 *
 * Two sources, and the order matters. AUTH_USERS is the seed: set in the
 * environment, never written to, and the reason a store that is empty,
 * unreachable or misconfigured cannot lock everybody out. The store holds
 * everybody added since, which is what makes adding somebody a thing you do on
 * the accounts page rather than a value you paste into a deployment and
 * redeploy for.
 *
 * AUTH_USERS='[{"username":"alice","passwordHash":"$2a$12$..."}]'
 *
 * An account in both is the stored one, so a password can be changed later
 * without the seed overriding it on every read.
 *
 * Entries keyed on "email" from before usernames existed still work: the email
 * is treated as the login name, so an older AUTH_USERS cannot lock anyone out.
 */

import { kvConfigured, kvGetJSON, kvSetJSON } from "./kv";
export type AppUser = {
  /** What the person types to sign in. Lowercased. */
  username: string;
  passwordHash: string;
};

let cached: AppUser[] | null = null;

/**
 * Accepts the list as plain JSON or as base64 of that JSON.
 *
 * Base64 is the form to prefer in a .env file. Next expands $NAME references
 * when it parses one, and its pattern matches digits, so the $2a$12$<salt>
 * prefix of every bcrypt hash is read as three undefined variables and silently
 * deleted. The hash then never matches and sign-in fails with no clue why.
 * Quoting does not help: dotenv strips the quotes before expansion runs.
 * Platform-set variables such as Vercel's are unaffected, so plain JSON is
 * still accepted for those.
 */
function decode(raw: string): string {
  let value = raw.trim();

  // Tolerate a whole "AUTH_USERS=..." line being pasted into a field that wants
  // only the value. Easy mistake, and the failure is otherwise opaque.
  value = value.replace(/^AUTH_USERS\s*=\s*/i, "").trim();

  // ...and surrounding quotes, which a .env habit tends to add.
  if (
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    value = value.slice(1, -1).trim();
  }

  if (value.startsWith("[")) return value;

  // A pasted value can pick up newlines; base64 has no use for whitespace.
  return Buffer.from(value.replace(/\s+/g, ""), "base64").toString("utf8");
}

type RawUser = {
  username?: unknown;
  email?: unknown;
  name?: unknown;
  passwordHash?: unknown;
};

/** Accepts username, or email as the login name for pre-username entries. */
function loginNameOf(raw: RawUser): string | null {
  for (const candidate of [raw.username, raw.email, raw.name]) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim().toLowerCase();
    }
  }
  return null;
}

/** Reads only the environment. The seed, which is never written to. */
export function getUsers(): AppUser[] {
  if (cached) return cached;

  const raw = process.env.AUTH_USERS;
  // No seed is not an error on its own any more: the store may hold the lot.
  // Whether anybody can sign in at all is settled in everyUser.
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(decode(raw));
  } catch {
    const seen = raw.trim();
    throw new Error(
      "AUTH_USERS is neither valid JSON nor base64 of a JSON array. It is " +
        seen.length +
        " characters starting " +
        JSON.stringify(seen.slice(0, 12)) +
        ". Paste only the value, with no AUTH_USERS= prefix and no quotes, or regenerate it with: npm run users"
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error("AUTH_USERS must be a JSON array.");
  }

  const users: AppUser[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as RawUser;
    const username = loginNameOf(row);
    if (!username) continue;
    if (typeof row.passwordHash !== "string" || !row.passwordHash) continue;
    users.push({ username, passwordHash: row.passwordHash });
  }

  if (users.length === 0) {
    throw new Error(
      "AUTH_USERS parsed but contained no usable users. Each entry needs a username and a passwordHash."
    );
  }

  cached = users;
  return cached;
}

const KEY = "content-automation:accounts";

/** The accounts added since, which live where the rest of this app's state does. */
export async function storedUsers(): Promise<AppUser[]> {
  if (!kvConfigured()) return [];
  const rows = await kvGetJSON<AppUser[]>(KEY);
  if (!Array.isArray(rows)) return [];

  const users: AppUser[] = [];
  for (const row of rows) {
    const username = loginNameOf((row ?? {}) as RawUser);
    if (!username) continue;
    if (typeof row?.passwordHash !== "string" || !row.passwordHash) continue;
    users.push({ username, passwordHash: row.passwordHash });
  }
  return users;
}

export async function putStoredUsers(users: AppUser[]): Promise<boolean> {
  if (!kvConfigured()) return false;
  return kvSetJSON(KEY, users);
}

/**
 * Everybody, seed and stored together.
 *
 * A stored account shadows a seed one of the same name, so a password changed
 * here is not undone by the value still sitting in the environment.
 */
export async function everyUser(): Promise<AppUser[]> {
  const seed = getUsers();
  const stored = await storedUsers();

  const merged = new Map<string, AppUser>();
  for (const user of seed) merged.set(user.username, user);
  for (const user of stored) merged.set(user.username, user);

  if (merged.size === 0) {
    throw new Error(
      "There are no accounts. Set AUTH_USERS to a JSON array of " +
        "{username, passwordHash} in your environment, or generate one with: npm run users",
    );
  }
  return [...merged.values()];
}

export async function findUser(username: string): Promise<AppUser | undefined> {
  const needle = username.trim().toLowerCase();
  return (await everyUser()).find((u) => u.username === needle);
}

/** Drop the memoised list so the next read sees a freshly set AUTH_USERS. */
export function refresh(): void {
  cached = null;
}

/**
 * The env-var form of a list. Base64 because Next expands $NAME when it parses
 * a .env file and would otherwise eat the $2a$12$ prefix of every hash.
 */
export function encodeUsers(users: AppUser[]): string {
  return Buffer.from(JSON.stringify(users), "utf8").toString("base64");
}
