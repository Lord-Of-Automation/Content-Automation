/**
 * Encryption for credentials this app stores on someone else's behalf.
 *
 * A WordPress password is not ours to hold in the clear: it is reused, it is
 * pasted into a browser, and the store it lands in is shared infrastructure.
 * AES-256-GCM keyed from AUTH_SECRET means a dump of the KV store, or of
 * .data/sites.json, is not a list of logins.
 *
 * This is not a substitute for using WordPress application passwords, which are
 * revocable and scoped. It is the floor, not the ceiling.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function key(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not set, so stored credentials cannot be encrypted or read."
    );
  }
  // A fixed salt keyed to this use, so the same secret yields the same key and
  // yet is not the key used for anything else.
  return scryptSync(secret, "content-automation:site-credentials", 32);
}

/** Returns "iv.tag.ciphertext", all base64url. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

/** Throws if the value was tampered with or the secret has changed. */
export function decrypt(payload: string): string {
  const [ivPart, tagPart, dataPart] = payload.split(".");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("Stored value is not in the expected format.");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    key(),
    Buffer.from(ivPart, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));

  return (
    decipher.update(Buffer.from(dataPart, "base64url")).toString("utf8") +
    decipher.final("utf8")
  );
}

/** True when a value can be read back, used to report a rotated AUTH_SECRET. */
export function canDecrypt(payload: string): boolean {
  try {
    decrypt(payload);
    return true;
  } catch {
    return false;
  }
}
