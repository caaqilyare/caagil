import { NextResponse } from "next/server";
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";
import { currentUser } from "@/lib/auth";
import { getModel, SYSTEM_PROMPT, tools } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { messages } = (await req.json().catch(() => ({}))) as { messages?: UIMessage[] };
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

  const result = streamText({
    model,
    system: `${SYSTEM_PROMPT}\n\nSigned-in operator: ${user.email}`,
    messages: convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse();
}
