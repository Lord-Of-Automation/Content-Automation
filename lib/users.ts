/**
 * The user list lives in an env var rather than a database. There is no signup,
 * no password reset and no per-user state to store, so a table would be pure
 * overhead. Generate the value with `npm run users -- alice bob`.
 *
 * AUTH_USERS='[{"username":"alice","passwordHash":"$2a$12$..."}]'
 *
 * Entries keyed on "email" from before usernames existed still work: the email
 * is treated as the login name, so an older AUTH_USERS cannot lock anyone out.
 */
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

export function getUsers(): AppUser[] {
  if (cached) return cached;

  const raw = process.env.AUTH_USERS;
  if (!raw) {
    throw new Error(
      "AUTH_USERS is not set. Add a JSON array of {username, passwordHash} to your environment."
    );
  }

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

export function findUser(username: string): AppUser | undefined {
  const needle = username.trim().toLowerCase();
  return getUsers().find((u) => u.username === needle);
}
