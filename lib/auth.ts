import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { execute, one } from "./db";
import { randomId, randomToken, verifyPassword } from "./crypto";

const COOKIE = "caaqil_session";
/** Cookie issued before the rename; still read so nobody is signed out. */
const LEGACY_COOKIE = "caagil_session";
const TTL_MS = 1000 * 60 * 60 * 24 * 14;

export type SessionUser = { id: string; email: string; role: string };

type UserRow = { id: string; email: string; password: string; role: string };

export async function authenticate(login: string, password: string): Promise<SessionUser | null> {
  // The users.email column stores the sign-in name, which may be a plain
  // username or an email address (both are lowercased at setup).
  const user = await one<UserRow>("SELECT id, email, password, role FROM users WHERE email = ?", [
    login.trim().toLowerCase(),
  ]);
  if (!user) return null;
  if (!verifyPassword(password, user.password)) return null;
  return { id: user.id, email: user.email, role: user.role };
}

export async function createSession(userId: string, secure = process.env.NODE_ENV === "production"): Promise<void> {
  const token = randomToken(32);
  const expires = Date.now() + TTL_MS;
  await execute("INSERT INTO sessions(id, user_id, expires_at) VALUES(?,?,?)", [
    token,
    userId,
    expires,
  ]);
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Plain-HTTP IP access needs a non-Secure cookie, otherwise login loops.
    secure,
    path: "/",
    expires: new Date(expires),
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value ?? jar.get(LEGACY_COOKIE)?.value;
  if (token) await execute("DELETE FROM sessions WHERE id = ?", [token]).catch(() => {});
  jar.delete(COOKIE);
  jar.delete(LEGACY_COOKIE);
}

export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value ?? jar.get(LEGACY_COOKIE)?.value;
  if (!token) return null;
  const row = await one<UserRow>(
    `SELECT u.id, u.email, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`,
    [token, Date.now()],
  );
  return row ? { id: row.id, email: row.email, role: row.role } : null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/** Ensures an owner exists, creating one from env on demand (used by the login page). */
export async function ensureOwner(): Promise<{ created: boolean; email?: string }> {
  const existing = await one<{ c: number }>("SELECT COUNT(*) AS c FROM users");
  if (Number(existing?.c ?? 0) > 0) return { created: false };
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return { created: false };
  const { hashPassword } = await import("./crypto");
  await execute("INSERT INTO users(id, email, password, role, created_at) VALUES(?,?,?,?,?)", [
    randomId("usr"),
    email.toLowerCase(),
    hashPassword(password),
    "owner",
    Date.now(),
  ]);
  return { created: true, email };
}
