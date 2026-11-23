import { NextResponse } from "next/server";
import { authenticate, createSession } from "@/lib/auth";

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
  const user = await authenticate(login, body.password);
  if (!user) {
    return NextResponse.json({ error: "Wrong username/email or password." }, { status: 401 });
  }
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(/:$/, "");
  await createSession(user.id, proto === "https");
  return NextResponse.json({ ok: true, user });
}
