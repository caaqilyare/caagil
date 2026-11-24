import { NextResponse } from "next/server";

/**
 * Defense-in-depth against cross-site request forgery: every mutating API
 * route must present an Origin (or Referer) that matches the Host serving
 * the request. SameSite=Lax cookies already block most cross-site POSTs;
 * this check also stops cross-origin fetches from compromised pages and
 * tooling that ignores SameSite.
 */
export function sameOrigin(req: Request): boolean {
  const host = req.headers.get("host");
  if (!host) return false;
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!origin) {
    // Non-browser clients (curl, server-to-server) send no Origin; allow
    // only when the request is same-host via X-Requested-With, else reject.
    return req.headers.get("x-requested-with") === "caaqil-panel";
  }
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Returns a 403 response when the origin check fails, otherwise null. */
export function originGuard(req: Request): NextResponse | null {
  if (sameOrigin(req)) return null;
  return NextResponse.json(
    { error: "Request blocked: cross-origin state change is not allowed." },
    { status: 403 },
  );
}
