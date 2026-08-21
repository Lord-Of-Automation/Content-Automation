/**
 * The user list lives in an env var rather than a database. There is no signup,
 * no password reset and no per-user state to store, so a table would be pure
 * overhead. Generate hashes with `npm run hash -- "your password"`.
 *
 * AUTH_USERS='[{"email":"me@example.com","name":"Me","passwordHash":"$2a$12$..."}]'
 */
export type AppUser = {
  email: string;
  name: string;
  passwordHash: string;
};

let cached: AppUser[] | null = null;

export function getUsers(): AppUser[] {
  if (cached) return cached;

  const raw = process.env.AUTH_USERS;
  if (!raw) {
    throw new Error(
      "AUTH_USERS is not set. Add a JSON array of {email, name, passwordHash} to your environment."
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AUTH_USERS is not valid JSON. It must be a JSON array.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("AUTH_USERS must be a JSON array.");
  }

  const users = parsed.filter(
    (u): u is AppUser =>
      !!u &&
      typeof u === "object" &&
      typeof (u as AppUser).email === "string" &&
      typeof (u as AppUser).passwordHash === "string"
  );

  if (users.length === 0) {
    throw new Error("AUTH_USERS parsed but contained no usable users.");
  }

  cached = users.map((u) => ({
    email: u.email.trim().toLowerCase(),
    name: u.name || u.email,
    passwordHash: u.passwordHash,
  }));

  return cached;
}

export function findUser(email: string): AppUser | undefined {
  const needle = email.trim().toLowerCase();
  return getUsers().find((u) => u.email === needle);
}
