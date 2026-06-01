import "server-only";
import crypto from "node:crypto";

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) {
    throw new Error(
      "ENCRYPTION_KEY env var is required (32 bytes, base64). Generate with: openssl rand -base64 32",
    );
  }
  const buf = Buffer.from(k, "base64");
  if (buf.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to 32 bytes (base64-encoded).");
  }
  return buf;
}

/** Encrypts plaintext, returns base64(iv || authTag || ciphertext). */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decrypt(payload: string): string {
  const key = getKey();
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

export function last4(value: string): string {
  if (value.length <= 4) return value;
  return value.slice(-4);
}

/** Encrypt a JSON-serializable value. */
export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

/** Decrypt a JSON value previously stored with encryptJson. Returns null on
 *  missing input or any decryption error. */
export function decryptJson<T>(payload: string | null | undefined): T | null {
  if (!payload) return null;
  try {
    return JSON.parse(decrypt(payload)) as T;
  } catch {
    return null;
  }
}

/** Keyed HMAC-SHA256 hex digest, keyed by the app ENCRYPTION_KEY. Used
 *  as a one-way lookup token — e.g. hashing an email so we can match a
 *  person by email without ever storing the plaintext address at rest.
 *  Deterministic, so the same input always yields the same digest. */
export function hmac(value: string): string {
  return crypto.createHmac("sha256", getKey()).update(value).digest("hex");
}

/** Sign an arbitrary string with the app key. Returns "<value>.<sig>".
 *  Used for stateless signed cookies (the public shepherd-intake
 *  session). verifySigned returns the original value only if the
 *  signature checks out. */
export function sign(value: string): string {
  const sig = crypto
    .createHmac("sha256", getKey())
    .update(value)
    .digest("base64url");
  return `${value}.${sig}`;
}

export function verifySigned(token: string | undefined | null): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const value = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto
    .createHmac("sha256", getKey())
    .update(value)
    .digest("base64url");
  // Constant-time compare to avoid leaking via timing.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return value;
}
