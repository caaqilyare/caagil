import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { all, execute, one } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const thread = new URL(req.url).searchParams.get("thread")?.trim();
  if (thread) {
    const owner = await one<{ id: string }>(
      "SELECT id FROM ai_threads WHERE id = ? AND user_id = ?",
      [thread, user.id],
    );
    if (!owner) return NextResponse.json({ error: "thread not found" }, { status: 404 });
    const messages = await all<{ id: number; role: string; content: string; ts: number }>(
      "SELECT id, role, content, ts FROM ai_messages WHERE thread = ? ORDER BY id ASC",
      [thread],
    );
    return NextResponse.json({ thread, messages });
  }

  const threads = await all<{ id: string; title: string; created_at: number; updated_at: number }>(
    "SELECT id, title, created_at, updated_at FROM ai_threads WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50",
    [user.id],
  );
  return NextResponse.json({ threads });
}

export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const thread = new URL(req.url).searchParams.get("thread")?.trim();
  if (!thread) return NextResponse.json({ error: "thread is required" }, { status: 400 });

  const owner = await one<{ id: string }>(
    "SELECT id FROM ai_threads WHERE id = ? AND user_id = ?",
    [thread, user.id],
  );
  if (!owner) return NextResponse.json({ error: "thread not found" }, { status: 404 });

  await execute("DELETE FROM ai_messages WHERE thread = ?", [thread]);
  await execute("DELETE FROM ai_threads WHERE id = ? AND user_id = ?", [thread, user.id]);
  return NextResponse.json({ ok: true });
}
