import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { currentUser } from "@/lib/auth";
import { execute, one } from "@/lib/db";
import { buildSystemPrompt, createTools, getModel } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function extractText(msg: UIMessage): string {
  return (msg.parts ?? [])
    .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    messages?: UIMessage[];
    threadId?: string;
  };
  const { messages } = body;
  if (!Array.isArray(messages)) {
    return NextResponse.json({ error: "messages[] is required" }, { status: 400 });
  }

  let model;
  try {
    model = await getModel();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }

  const threadId = (body.threadId || "").trim() || crypto.randomUUID().slice(0, 16);
  const now = Date.now();
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastText = lastUser ? extractText(lastUser) : "";

  if (lastText) {
    const existing = await one<{ id: string }>(
      "SELECT id FROM ai_threads WHERE id = ? AND user_id = ?",
      [threadId, user.id],
    ).catch(() => null);
    if (!existing) {
      const title = lastText.slice(0, 90) || "New chat";
      await execute(
        "INSERT INTO ai_threads(id, user_id, title, created_at, updated_at) VALUES(?,?,?,?,?)",
        [threadId, user.id, title, now, now],
      ).catch(() => {});
    } else {
      await execute("UPDATE ai_threads SET updated_at = ? WHERE id = ?", [now, threadId]).catch(() => {});
    }
    await execute(
      "INSERT INTO ai_messages(thread, role, content, ts) VALUES(?,?,?,?)",
      [threadId, "user", lastText, now],
    ).catch(() => {});
  }

  const systemPrompt = await buildSystemPrompt(user.id, user.email);

  const result = streamText({
    model,
    system: systemPrompt,
    messages: convertToModelMessages(messages),
    tools: createTools(user.id),
    stopWhen: stepCountIs(12),
    onFinish: async ({ text }) => {
      const clean = (text || "").trim();
      if (!clean) return;
      const doneAt = Date.now();
      await execute(
        "INSERT INTO ai_messages(thread, role, content, ts) VALUES(?,?,?,?)",
        [threadId, "assistant", clean, doneAt],
      ).catch(() => {});
      await execute("UPDATE ai_threads SET updated_at = ? WHERE id = ?", [doneAt, threadId]).catch(() => {});
    },
  });

  return result.toUIMessageStreamResponse({
    headers: { "x-caaqil-thread": threadId },
  });
}
