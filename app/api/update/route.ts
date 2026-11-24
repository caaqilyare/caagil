import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { checkForUpdate, startRollback, startUpdate } from "@/lib/updater";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await checkForUpdate());
}

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string };
    if (body.action === "rollback") {
      return NextResponse.json({ ok: true, ...(await startRollback()) });
    }
    return NextResponse.json({ ok: true, ...(await startUpdate()) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
