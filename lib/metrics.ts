/**
 * Resource-metrics history: a small ring of samples in MySQL powering the
 * dashboard charts (1H/6H/24H/7D/30D) and threshold alerts.
 * Sampling is throttled to one row per minute; the scheduler records samples
 * and any /api/state poll backfills the latest reading.
 */
import { execute, one, query, getSetting, setSetting, logActivity } from "./db";
import type { SystemStats } from "./stats";

export type MetricSample = {
  ts: number;
  cpu: number;
  memPct: number;
  memUsedMb: number;
  diskPct: number;
  diskUsedGb: number;
  load1: number;
};

export const ALERT_THRESHOLDS = { disk: 90, mem: 90 };
const SAMPLE_INTERVAL_MS = 60 * 1000;

/** Insert one sample per minute (idempotent per minute bucket). */
export async function recordSample(stats: SystemStats): Promise<void> {
  const last = await one<{ ts: number }>("SELECT MAX(ts) AS ts FROM metrics");
  if (last?.ts && Date.now() - Number(last.ts) < SAMPLE_INTERVAL_MS - 5000) return;
  const ts = Math.floor(Date.now() / SAMPLE_INTERVAL_MS) * SAMPLE_INTERVAL_MS;
  await execute(
    `INSERT INTO metrics(ts, cpu, mem_pct, mem_used_mb, disk_pct, disk_used_gb, load1)
     VALUES (?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE cpu = VALUES(cpu), mem_pct = VALUES(mem_pct),
       mem_used_mb = VALUES(mem_used_mb), disk_pct = VALUES(disk_pct),
       disk_used_gb = VALUES(disk_used_gb), load1 = VALUES(load1)`,
    [
      ts,
      stats.cpu.percent,
      stats.memory.percent,
      stats.memory.usedMb,
      stats.disk.percent,
      stats.disk.usedGb,
      stats.cpu.load1,
    ].map(Number),
  );
  await checkAlerts(stats);
}

export const RANGES = {
  "1h": { bucketMs: 60 * 1000, points: 60 },
  "6h": { bucketMs: 5 * 60 * 1000, points: 72 },
  "24h": { bucketMs: 15 * 60 * 1000, points: 96 },
  "7d": { bucketMs: 60 * 60 * 1000, points: 168 },
  "30d": { bucketMs: 6 * 60 * 60 * 1000, points: 120 },
} as const;

export type MetricRange = keyof typeof RANGES;

export function parseRange(value: string | null): MetricRange {
  return value && value in RANGES ? (value as MetricRange) : "24h";
}

/** Bucket-averaged series for the given range (oldest first). */
export async function getSeries(range: MetricRange): Promise<MetricSample[]> {
  const { bucketMs, points } = RANGES[range];
  const since = Date.now() - bucketMs * points;
  const rows = await query<
    { bucket: number; cpu: number; mem_pct: number; mem_used_mb: number; disk_pct: number; disk_used_gb: number; load1: number }[]
  >(
    `SELECT FLOOR(ts / ?) AS bucket,
            AVG(cpu) AS cpu, AVG(mem_pct) AS mem_pct, AVG(mem_used_mb) AS mem_used_mb,
            AVG(disk_pct) AS disk_pct, AVG(disk_used_gb) AS disk_used_gb, AVG(load1) AS load1
       FROM metrics
      WHERE ts > ?
      GROUP BY bucket
      ORDER BY bucket ASC`,
    [bucketMs, since],
  );
  return rows.map((r) => ({
    ts: Number(r.bucket) * bucketMs,
    cpu: Math.round(Number(r.cpu) * 10) / 10,
    memPct: Math.round(Number(r.mem_pct) * 10) / 10,
    memUsedMb: Math.round(Number(r.mem_used_mb)),
    diskPct: Math.round(Number(r.disk_pct) * 10) / 10,
    diskUsedGb: Math.round(Number(r.disk_used_gb) * 10) / 10,
    load1: Math.round(Number(r.load1) * 100) / 100,
  }));
}

/**
 * Threshold alerts, logged at most once per hour per kind so the activity
 * feed is not flooded by a sustained load spike.
 */
async function checkAlerts(stats: SystemStats): Promise<void> {
  const checks: { kind: string; value: number; threshold: number; message: string }[] = [];
  if (stats.disk.percent >= ALERT_THRESHOLDS.disk) {
    checks.push({
      kind: "alert_disk",
      value: stats.disk.percent,
      threshold: ALERT_THRESHOLDS.disk,
      message: `Disk usage is ${stats.disk.percent}% (${stats.disk.usedGb} GB of ${stats.disk.totalGb} GB)`,
    });
  }
  if (stats.memory.percent >= ALERT_THRESHOLDS.mem) {
    checks.push({
      kind: "alert_mem",
      value: stats.memory.percent,
      threshold: ALERT_THRESHOLDS.mem,
      message: `Memory usage is ${stats.memory.percent}% (${stats.memory.usedMb} MB of ${stats.memory.totalMb} MB)`,
    });
  }
  for (const check of checks) {
    const last = await getSetting(`${check.kind}_ts`);
    if (last && Date.now() - Number(last) < 60 * 60 * 1000) continue;
    await setSetting(`${check.kind}_ts`, String(Date.now()));
    await logActivity(check.kind, check.message, "monitor", false);
  }
}

/** Housekeeping: keep at most 30 days of samples. */
export async function pruneMetrics(): Promise<void> {
  try {
    await execute("DELETE FROM metrics WHERE ts < ?", [Date.now() - 30 * 24 * 60 * 60 * 1000]);
  } catch {
    /* ignore */
  }
}
