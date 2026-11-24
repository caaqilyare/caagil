import { NextResponse } from "next/server";
import { authenticate, createSession } from "@/lib/auth";
import { loginAllowed, recordLoginAttempt, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    login?: string;
    email?: string;
    password?: string;
  };
  // `email` is accepted for older clients; the field stores the login name
  // (username or email), so both work.
  const login = (body.login ?? body.email ?? "").trim();
  if (!login || !body.password) {
    return NextResponse.json({ error: "Username/email and password are required." }, { status: 400 });
  }

  const ip = clientIp(req);

  // Brute-force gate: do not even attempt authentication while blocked, and
  // record the (blocked) attempt so the window keeps counting.
  const gate = await loginAllowed(ip, login);
  if (!gate.allowed) {
    await recordLoginAttempt(ip, login, false);
    return NextResponse.json({ error: gate.reason ?? "Too many attempts." }, { status: 429 });
  }

  const user = await authenticate(login, body.password);
  if (!user) {
    await recordLoginAttempt(ip, login, false);
    return NextResponse.json({ error: "Wrong username/email or password." }, { status: 401 });
  }

  await recordLoginAttempt(ip, login, true);
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(/:$/, "");
  await createSession(user.id, proto === "https");
  return NextResponse.json({ ok: true, user });
}
