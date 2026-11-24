import crypto from "node:crypto";

export function randomId(prefix = ""): string {
  const raw = crypto.randomBytes(8).toString("hex");
  return prefix ? `${prefix}_${raw}` : raw;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, salt, hash] = stored.split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

export function sign(value: string): string {
  const secret = process.env.AUTH_SECRET || "insecure-dev-secret";
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

/** Timing-safe string comparison for tokens and secrets. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* ─────────────────────── secret encryption at rest ───────────────────────
 * Stored database credentials are encrypted with AES-256-GCM using a key
 * derived from AUTH_SECRET. Values are written with an "enc:v1:" prefix so
 * legacy plaintext rows (prefix absent) still decrypt transparently.
 * ──────────────────────────────────────────────────────────────────────── */

const ENC_PREFIX = "enc:v1:";

function secretKey(): Buffer {
  const secret = process.env.AUTH_SECRET || "insecure-dev-secret";
  return crypto.scryptSync(secret, "caaqil-secret-encryption", 32);
}

/** Encrypt a secret for storage. Returns "enc:v1:<iv>:<tag>:<ciphertext>" (base64url). */
export function encryptSecret(plain: string): string {
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return (
    ENC_PREFIX +
    iv.toString("base64url") +
    ":" +
    tag.toString("base64url") +
    ":" +
    enc.toString("base64url")
  );
}

/** Decrypt a stored secret; legacy plaintext values pass through unchanged. */
export function decryptSecret(stored: string | null | undefined): string {
  if (!stored) return "";
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy plaintext row
  try {
    const [ivB64, tagB64, dataB64] = stored.slice(ENC_PREFIX.length).split(":");
    if (!ivB64 || !tagB64 || !dataB64) return "";
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      secretKey(),
      Buffer.from(ivB64, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong AUTH_SECRET or tampered row — never leak the ciphertext.
    return "";
  }
}

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export function shortPassword(length = 20): string {
  const buf = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[buf[i] % ALPHABET.length];
  return out;
}
