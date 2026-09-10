import { createHmac, randomBytes } from "node:crypto";

/**
 * A nonce the callback can prove this app issued.
 *
 * Signed rather than stored, because this app keeps nothing between requests:
 * it is redeployed whenever anybody pushes and runs on whichever instance
 * answers next, so a value written down when the consent starts would not be
 * there to compare against when Google sends the browser back.
 *
 * AUTH_SECRET is the key. It is already the thing that makes a session
 * unforgeable here, it is already required for the app to run at all, and a
 * second secret to protect a thirty-second round trip would be one more thing
 * to set and get wrong.
 */
export function signState(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) throw new Error("AUTH_SECRET is not set, so the connection cannot be secured.");

  // Minutes, not hours. This exists to cover a redirect, and a nonce that
  // stays good for an afternoon is a nonce worth stealing.
  const until = Date.now() + 10 * 60 * 1000;
  const nonce = randomBytes(12).toString("hex");
  const body = `${until}.${nonce}`;
  const mark = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${mark}`;
}

/**
 * Whether a state came from here and is still young.
 *
 * Without this, anyone who could get a signed-in browser to load the callback
 * with a code of their choosing could attach their own mailbox to this
 * platform, and every message afterwards would go from it.
 */
export function stateHolds(state: string): boolean {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) return false;

  const parts = String(state ?? "").split(".");
  if (parts.length !== 3) return false;

  const [until, nonce, mark] = parts;
  const wanted = createHmac("sha256", secret).update(`${until}.${nonce}`).digest("base64url");

  if (mark!.length !== wanted.length) return false;
  if (mark !== wanted) return false;

  return Number(until) > Date.now();
}
