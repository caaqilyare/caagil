import { NextResponse } from "next/server";
import { createSession } from "@/lib/auth";
import { execute, one, setSetting, logActivity } from "@/lib/db";
import { hashPassword, randomId } from "@/lib/crypto";

export const dynamic = "force-dynamic";

type Body = { login?: string; password?: string; panelName?: string };

export async function POST(req: Request) {
  const users = await one<{ c: number }>("SELECT COUNT(*) AS c FROM users");
  if (Number(users?.c ?? 0) > 0) {
    return NextResponse.json({ error: "Setup is already complete." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const login = String(body.login ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const panelName = String(body.panelName ?? "").trim();

  if (!/^[a-z0-9][a-z0-9._@+-]{2,79}$/.test(login)) {
    return NextResponse.json(
      { error: "Username must be 3–80 characters: letters, numbers, dot, dash, underscore, @ or +." },
      { status: 400 },
    );
  }
  if (password.length < 10) {
    return NextResponse.json({ error: "Password must be at least 10 characters." }, { status: 400 });
  }

  const id = randomId("usr");
  // Conditional insert: only the first setup request can create the owner.
  const created = await execute(
    `INSERT INTO users(id, email, password, role, created_at)
     SELECT ?,?,?,?,? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM users)`,
    [id, login, hashPassword(password), "owner", Date.now()],
  );
  if (created.affectedRows !== 1) {
    return NextResponse.json({ error: "Setup is already complete." }, { status: 403 });
  }
  if (panelName) await setSetting("panel_name", panelName.slice(0, 40));

  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(/:$/, "");
  await createSession(id, proto === "https");
  await logActivity("setup.complete", login, login);

  return NextResponse.json({ ok: true, user: { id, login, role: "owner" } });
}
