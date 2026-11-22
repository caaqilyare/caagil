import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { getJob } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/** Live status of a background job (deploy, WordPress install, …). */
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await context.params;
  const job = getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  return NextResponse.json(job);
}
