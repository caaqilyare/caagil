import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { aiConfig, PROVIDERS } from "@/lib/ai";
import { ENGINES, PRESETS } from "@/lib/presets";
import { overview } from "@/lib/ops";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const [state, ai] = await Promise.all([overview(), aiConfig()]);

  return NextResponse.json({
    user,
    ...state,
    ai: { provider: ai.provider, model: ai.model, label: ai.label, hasKey: Boolean(ai.key) },
    providers: PROVIDERS.map((p) => ({ id: p.id, label: p.label, models: p.models })),
    presets: PRESETS,
    engines: ENGINES,
  });
}
