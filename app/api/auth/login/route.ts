import { NextResponse } from "next/server";
import { authenticate, createSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!body.email || !body.password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }
  const user = await authenticate(body.email, body.password);
  if (!user) {
    return NextResponse.json({ error: "Wrong email or password." }, { status: 401 });
  }
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(/:$/, "");
  await createSession(user.id, proto === "https");
  return NextResponse.json({ ok: true, user });
}
