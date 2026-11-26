import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { deleteMemory, getCustomRules, listMemories, saveMemory, setCustomRules } from "@/lib/ai";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [memories, rules] = await Promise.all([listMemories(user.id), getCustomRules()]);
  return NextResponse.json({ memories, rules });
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    content?: string;
    category?: string;
    rules?: string;
  };

  if (typeof body.rules === "string") {
    await setCustomRules(body.rules);
    return NextResponse.json({ ok: true, rules: body.rules.trim() });
  }

  if (typeof body.content === "string" && body.content.trim()) {
    const memory = await saveMemory(user.id, body.content, body.category || "general");
    return NextResponse.json({ ok: true, memory });
  }

  return NextResponse.json({ error: "content or rules is required" }, { status: 400 });
}

export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  await deleteMemory(user.id, id);
  return NextResponse.json({ ok: true });
}
