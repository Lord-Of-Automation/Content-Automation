#!/usr/bin/env node
/**
 * Build the AUTH_USERS value.
 *
 *   npm run users -- alice                 add alice, keep everyone else
 *   npm run users -- alice:"my password"   choose the password yourself
 *   npm run users -- alice --replace       start a fresh list with only alice
 *
 * AUTH_USERS holds the entire user list, so generating it from scratch would
 * silently reset every existing password. By default this reads the current
 * value out of .env.local and merges, which makes adding one person safe.
 */
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";
import { randomInt } from "node:crypto";

// No look-alike characters: someone will retype these from a screen.
const ALPHABET = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generatePassword(length = 20) {
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

const argv = process.argv.slice(2);
const replace = argv.includes("--replace");
const args = argv.filter((a) => a !== "--replace");

if (args.length === 0) {
  console.error(
    "Usage: npm run users -- username [username:password] ... [--replace]"
  );
  process.exit(1);
}

function readExisting() {
  if (replace) return [];
  let line;
  try {
    const lines = readFileSync(".env.local", "utf8").split(/\r?\n/);
    line = lines.find((l) => l.startsWith("AUTH_USERS="));
  } catch {
    return [];
  }
  if (!line) return [];
  try {
    const parsed = JSON.parse(line.slice("AUTH_USERS=".length));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((u) => ({
        // Older entries were keyed on email; that is the login name now.
        username: String(u.username ?? u.email ?? u.name ?? "")
          .trim()
          .toLowerCase(),
        passwordHash: String(u.passwordHash ?? ""),
      }))
      .filter((u) => u.username && u.passwordHash);
  } catch {
    return [];
  }
}

const specs = args.map((arg) => {
  // Split on the FIRST colon only: passwords may contain colons.
  const at = arg.indexOf(":");
  return {
    username: (at === -1 ? arg : arg.slice(0, at))
      .trim()
      .replace(/s+/g, " ")
      .toLowerCase(),
    password: at === -1 ? null : arg.slice(at + 1),
  };
});

const seen = new Set();
for (const s of specs) {
  // Lowercased at sign-in too, so capitals cannot lock anyone out. Spaces are
  // allowed inside the name but not at either end, where they would be invisible
  // and impossible to debug; findUser trims, so a stray one still signs in.
  if (!/^[a-z0-9][a-z0-9._ -]{0,30}[a-z0-9]$/.test(s.username)) {
    console.error(
      `Bad username "${s.username}". Use 2 to 32 characters, starting and ending ` +
        "with a letter or digit; letters, digits, spaces, dots, underscores and hyphens between."
    );
    process.exit(1);
  }
  if (seen.has(s.username)) {
    console.error(`Duplicate username: ${s.username}`);
    process.exit(1);
  }
  seen.add(s.username);
  if (s.password !== null && s.password.length < 10) {
    console.error(`Password for ${s.username} is under 10 characters.`);
    process.exit(1);
  }
}

const users = readExisting();
if (users.length) {
  console.log(
    `\nKeeping ${users.length} existing account${users.length === 1 ? "" : "s"}: ` +
      users.map((u) => u.username).join(", ")
  );
}

const table = [];

for (const s of specs) {
  const password = s.password ?? generatePassword();
  // Cost 12: a few hundred ms per attempt, which makes offline cracking of a
  // leaked hash expensive while staying invisible at sign-in.
  const passwordHash = await bcrypt.hash(password, 12);

  const at = users.findIndex((u) => u.username === s.username);
  if (at === -1) {
    users.push({ username: s.username, passwordHash });
  } else {
    console.log(`  resetting the password for existing account ${s.username}`);
    users[at] = { username: s.username, passwordHash };
  }
  table.push({ username: s.username, password, generated: s.password === null });
}

console.log("\nCredentials (generated passwords are shown once and not stored):\n");
for (const row of table) {
  console.log(
    `  ${row.username.padEnd(24)} ${row.password}${row.generated ? "" : "   (yours)"}`
  );
}

// Base64 so the bcrypt hashes survive .env parsing: Next expands $NAME when it
// reads a .env file, and its pattern matches digits, so $2a$12$<salt> is eaten
// as three undefined variables. Platform variables (Vercel) are unaffected, but
// one format that works everywhere beats two that each work in one place.
const encoded = Buffer.from(JSON.stringify(users), "utf8").toString("base64");

console.log("
AUTH_USERS value, paste raw with no surrounding quotes:
");
console.log("AUTH_USERS=" + encoded);
console.log(
  `\n${users.length} account${users.length === 1 ? "" : "s"} total. Set this in .env.local and in Vercel,\n` +
    "then redeploy. Removing someone stops them signing in; rotate AUTH_SECRET to\n" +
    "kill sessions that are already live.\n"
);
