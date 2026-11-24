import { NextResponse } from "next/server";
import { exchangeToken } from "@/lib/pma";

export const dynamic = "force-dynamic";

/**
 * Internal server-to-server endpoint for the phpMyAdmin signon bridge:
 *   GET/POST /api/pma/exchange?t=<one-time-token>
 *   header:  x-caaqil-internal: <shared secret>
 *
 * Auth: the shared internal secret (stored encrypted, regenerated on demand)
 * plus a single-use, 60-second token whose SHA-256 hash is stored server-side.
 * On success the limited phpMyAdmin MySQL credentials are returned once and
 * the token is atomically claimed (single-use). No session cookies involved.
 */
async function handle(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") ?? "";
  const internal = req.headers.get("x-caaqil-internal") ?? "";

  if (!token || !internal) {
    return NextResponse.json({ ok: false, error: "missing token or secret" }, { status: 401 });
  }

  const result = await exchangeToken(token, internal);
  if (!result.ok) {
    return NextResponse.json(result, { status: 403 });
  }
  return NextResponse.json(result);
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
