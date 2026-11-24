/**
 * Login rate limiting backed by the MySQL `login_attempts` table.
 * Two independent windows protect against brute force:
 *  - per source IP:   MAX_FAILS_IP failed logins inside WINDOW_MS
 *  - per login name:  MAX_FAILS_USER failed logins inside WINDOW_MS
 * A successful sign-in clears the failure record for that (ip, login) pair.
 */
import { execute, one, query } from "./db";

export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILS_IP = 10;
export const MAX_FAILS_USER = 8;

/** Pure window rule shared by the SQL checks below (unit tested). */
export function isBlocked(failTimestamps: number[], now: number): { blocked: boolean; retryAfterMs: number } {
  const recent = failTimestamps.filter((ts) => now - ts < WINDOW_MS);
  if (recent.length < MAX_FAILS_USER) return { blocked: false, retryAfterMs: 0 };
  const oldest = Math.min(...recent);
  return { blocked: true, retryAfterMs: oldest + WINDOW_MS - now };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim().slice(0, 45);
  return req.headers.get("x-real-ip")?.slice(0, 45) || "unknown";
}

export async function recordLoginAttempt(ip: string, login: string, ok: boolean): Promise<void> {
  try {
    await execute("INSERT INTO login_attempts(ip, login, ts, ok) VALUES(?,?,?,?)", [
      ip,
      login.trim().toLowerCase().slice(0, 190),
      Date.now(),
      ok ? 1 : 0,
    ]);
    if (ok) {
      // Successful sign-in: forget earlier failures for this pair.
      await execute("DELETE FROM login_attempts WHERE ok = 0 AND ip = ? AND login = ?", [ip, login.trim().toLowerCase().slice(0, 190)]);
    }
  } catch {
    /* rate limiting must never break the login flow */
  }
}

/**
 * True when more attempts from this IP or for this login are allowed.
 * Failures from BOTH windows are enforced; the reply stays generic.
 */
export async function loginAllowed(ip: string, login: string): Promise<{ allowed: boolean; reason?: string }> {
  const since = Date.now() - WINDOW_MS;
  try {
    const rows = await query<{ ts: number; ip: string; login: string }[]>(
      "SELECT ts, ip, login FROM login_attempts WHERE ok = 0 AND ts > ? AND (ip = ? OR login = ?) ORDER BY ts ASC",
      [since, ip, login.trim().toLowerCase()],
    );
    const now = Date.now();
    const byIp = rows.filter((r) => r.ip === ip).map((r) => Number(r.ts));
    const byUser = rows.filter((r) => r.login === login.trim().toLowerCase()).map((r) => Number(r.ts));

    if (byIp.length >= MAX_FAILS_IP) {
      return {
        allowed: false,
        reason: `Too many failed sign-ins from this network. Try again in ${Math.ceil(isBlocked(byIp, now).retryAfterMs / 60000)} minutes.`,
      };
    }
    const userCheck = isBlocked(byUser, now);
    if (userCheck.blocked) {
      return {
        allowed: false,
        reason: `Too many failed sign-ins for this account. Try again in ${Math.ceil(userCheck.retryAfterMs / 60000)} minutes.`,
      };
    }
    return { allowed: true };
  } catch {
    // If the table is unavailable, fail open — availability over strictness.
    return { allowed: true };
  }
}

/** Housekeeping: drop attempt rows older than the window. */
export async function pruneLoginAttempts(): Promise<void> {
  try {
    await execute("DELETE FROM login_attempts WHERE ts < ?", [Date.now() - WINDOW_MS * 2]);
  } catch {
    /* ignore */
  }
}

/** Count of failed attempts in the current window (Security Center display). */
export async function recentFailureCount(): Promise<number> {
  const row = await one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM login_attempts WHERE ok = 0 AND ts > ?",
    [Date.now() - WINDOW_MS],
  );
  return Number(row?.c ?? 0);
}
