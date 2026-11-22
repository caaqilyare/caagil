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
