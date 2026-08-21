#!/usr/bin/env node
/**
 * Generate a bcrypt hash for the AUTH_USERS env var.
 *
 *   npm run hash -- "the password"
 */
import bcrypt from "bcryptjs";

const password = process.argv[2];

if (!password) {
  console.error('Usage: npm run hash -- "your password"');
  process.exit(1);
}

if (password.length < 10) {
  console.error("Use at least 10 characters. This gates paid API runs.");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);

console.log("\nHash:\n" + hash);
console.log(
  "\nDrop it into AUTH_USERS, for example:\n" +
    JSON.stringify([
      { email: "you@example.com", name: "You", passwordHash: hash },
    ]) +
    "\n"
);
