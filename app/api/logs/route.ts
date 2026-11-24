import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { recentCronFailures } from "@/lib/cron-engine";

export const dynamic = "force-dynamic";

export type ActivityRow = {
  id: number;
  action: string;
  detail: string | null;
  actor: string | null;
  ok: number;
  ts: number;
};

/**
 * GET /api/logs?limit=200&level=errors — combined system log: activity feed
 * plus failed cron runs (the two places the panel records operational events).
 */
export async function GET(req: Request) {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 200, 10), 500);
  const onlyErrors = url.searchParams.get("level") === "errors";

  const activity = (await query<ActivityRow[]>(
    `SELECT id, action, detail, actor, ok, ts FROM activity
      ${onlyErrors ? "WHERE ok = 0" : ""}
      ORDER BY ts DESC LIMIT ?`,
    [limit],
  )) as unknown as ActivityRow[];

  let cronFailures: { jobName: string; ts: number; exitCode: number | null; output: string | null }[] = [];
  try {
    const runs = await recentCronFailures(25);
    cronFailures = runs.map((r) => ({
      jobName: r.job_name,
      ts: r.ts,
      exitCode: r.exit_code,
      output: r.output?.slice(0, 4000) ?? null,
    }));
  } catch {
    /* cron tables may not be migrated yet */
  }

  return NextResponse.json({ activity, cronFailures });
}
