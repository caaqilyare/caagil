import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { parseRange, getSeries, ALERT_THRESHOLDS } from "@/lib/metrics";

export const dynamic = "force-dynamic";

/** GET /api/metrics?range=1h|6h|24h|7d|30d — bucket-averaged history series. */
export async function GET(req: Request) {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const range = parseRange(url.searchParams.get("range"));
  const series = await getSeries(range);
  return NextResponse.json({ range, series, thresholds: ALERT_THRESHOLDS });
}
