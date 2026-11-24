/**
 * Cron job engine: CRUD for scheduled tasks, execution in the panel container
 * or inside an app container (docker exec), timeouts, run history and the
 * due-check used by the background scheduler.
 *
 * Trust model: only the panel owner can create cron jobs (single admin),
 * which matches the existing app-deployment trust level — the owner can
 * already run arbitrary images and edit any app file.
 */
import { spawn } from "node:child_process";
import { execute, one, query, logActivity } from "./db";
import { randomId } from "./crypto";
import { cronMatches, describeCron, nextRuns } from "./cron";
import { docker } from "./docker";
import type { Readable } from "node:stream";
import { PassThrough } from "node:stream";

export type CronJobRow = {
  id: string;
  name: string;
  expression: string;
  target_kind: "panel" | "app";
  target_name: string | null;
  command: string;
  enabled: number;
  timeout_sec: number;
  last_run_at: number | null;
  last_status: string | null;
  last_exit: number | null;
  last_duration_ms: number | null;
  created_at: number;
  updated_at: number;
};

export type CronRunRow = {
  id: number;
  job_id: string;
  job_name: string;
  ts: number;
  exit_code: number | null;
  duration_ms: number | null;
  output: string | null;
  ok: number;
  timeout: number;
};

const MAX_OUTPUT = 16 * 1024; // stored per run, tail-truncated

export async function listCronJobs(): Promise<CronJobRow[]> {
  return query<CronJobRow[]>("SELECT * FROM cron_jobs ORDER BY created_at DESC");
}

export async function getCronJob(id: string): Promise<CronJobRow | null> {
  return one<CronJobRow>("SELECT * FROM cron_jobs WHERE id = ?", [id]);
}

export type CronJobInput = {
  name: string;
  expression: string;
  targetKind: "panel" | "app";
  targetName?: string;
  command: string;
  timeoutSec?: number;
};

/** Validates everything (expression, target, command) and inserts the job. */
export async function createCronJob(
  input: CronJobInput,
  actor = "system",
): Promise<CronJobRow> {
  const { parseCron } = await import("./cron");
  parseCron(input.expression); // throws CronError with a clear message

  const name = input.name.trim();
  if (!name) throw new Error("A task name is required.");
  const command = input.command.trim();
  if (!command) throw new Error("A command is required.");

  const kind = input.targetKind === "app" ? "app" : "panel";
  let targetName: string | null = null;
  if (kind === "app") {
    targetName = (input.targetName ?? "").trim();
    const app = await one<{ id: string; status: string; container_id: string | null }>(
      "SELECT id, status, container_id FROM apps WHERE name = ?",
      [targetName],
    );
    if (!app) throw new Error(`App "${targetName}" does not exist.`);
    if (!app.container_id) throw new Error(`App "${targetName}" has no running container yet.`);
  }

  const timeout = Math.min(Math.max(Number(input.timeoutSec) || 300, 5), 3600);
  const id = randomId("cron");
  const now = Date.now();
  await execute(
    `INSERT INTO cron_jobs(id, name, expression, target_kind, target_name, command, enabled, timeout_sec, created_at, updated_at)
     VALUES (?,?,?,?,?,?,1,?,?,?)`,
    [id, name.slice(0, 120), input.expression.trim(), kind, targetName, command, timeout, now, now],
  );
  await logActivity("cron.create", `${name} · ${describeCron(input.expression)}`, actor);
  return (await getCronJob(id))!;
}

export async function updateCronJob(
  id: string,
  input: Partial<CronJobInput> & { enabled?: boolean },
  actor = "system",
): Promise<CronJobRow> {
  const job = await getCronJob(id);
  if (!job) throw new Error("Scheduled task not found.");

  const expression = input.expression?.trim() || job.expression;
  if (input.expression !== undefined) {
    const { parseCron } = await import("./cron");
    parseCron(expression);
  }
  const enabled = input.enabled !== undefined ? (input.enabled ? 1 : 0) : job.enabled;
  const timeout = input.timeoutSec
    ? Math.min(Math.max(Number(input.timeoutSec) || 300, 5), 3600)
    : job.timeout_sec;
  const command = input.command?.trim() || job.command;
  const name = input.name?.trim() || job.name;

  await execute(
    "UPDATE cron_jobs SET name = ?, expression = ?, command = ?, enabled = ?, timeout_sec = ?, updated_at = ? WHERE id = ?",
    [name.slice(0, 120), expression, command, enabled, timeout, Date.now(), id],
  );
  await logActivity("cron.update", job.name, actor);
  return (await getCronJob(id))!;
}

export async function deleteCronJob(id: string, actor = "system"): Promise<void> {
  const job = await getCronJob(id);
  if (!job) throw new Error("Scheduled task not found.");
  await execute("DELETE FROM cron_jobs WHERE id = ?", [id]);
  await execute("DELETE FROM cron_runs WHERE job_id = ?", [id]);
  await logActivity("cron.delete", job.name, actor);
}

export async function runCronJobNow(id: string, actor = "system"): Promise<{ runId: number }> {
  const job = await getCronJob(id);
  if (!job) throw new Error("Scheduled task not found.");
  const res = await executeJob(job, true);
  await logActivity(
    "cron.run",
    `${job.name}: ${res.ok ? "ok" : `failed (exit ${res.exit ?? "?"})`}${res.timedOut ? " — timed out" : ""}`,
    actor,
    res.ok,
  );
  return { runId: res.runId };
}

export async function cronJobHistory(jobId: string, limit = 30): Promise<CronRunRow[]> {
  return query<CronRunRow[]>(
    "SELECT * FROM cron_runs WHERE job_id = ? ORDER BY ts DESC LIMIT ?",
    [jobId, Math.min(limit, 200)],
  );
}

export async function recentCronFailures(limit = 10): Promise<CronRunRow[]> {
  return query<CronRunRow[]>(
    "SELECT * FROM cron_runs WHERE ok = 0 ORDER BY ts DESC LIMIT ?",
    [limit],
  );
}

/* ───────────────────────────── execution ───────────────────────────── */

type ExecResult = { exit: number | null; output: string; timedOut: boolean };

async function execPanelCommand(command: string, timeoutSec: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-lc", command], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutSec * 1000);
    child.stdout.on("data", (c: Buffer) => {
      if (chunks.reduce((n, b) => n + b.length, 0) < 64 * 1024) chunks.push(c);
    });
    child.stderr.on("data", (c: Buffer) => {
      if (chunks.reduce((n, b) => n + b.length, 0) < 64 * 1024) chunks.push(c);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ exit: 127, output: `spawn failed: ${err.message}`, timedOut: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exit: code,
        output: Buffer.concat(chunks).toString("utf8").slice(0, MAX_OUTPUT),
        timedOut,
      });
    });
  });
}

async function execInContainer(
  containerId: string,
  command: string,
  timeoutSec: number,
): Promise<ExecResult> {
  const container = docker.getContainer(containerId);
  // `timeout SECS sh -lc` works on GNU coreutils and busybox images alike.
  const exec = await container.exec({
    Cmd: ["sh", "-lc", `timeout ${timeoutSec} sh -lc ${shellQuote(command)}`],
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = (await exec.start({ hijack: true, stdin: false })) as Readable;
  const out = new PassThrough();
  const err = new PassThrough();
  docker.modem.demuxStream(stream, out, err);
  const chunks: Buffer[] = [];
  out.on("data", (c: Buffer) => chunks.push(c));
  err.on("data", (c: Buffer) => chunks.push(c));
  await new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  const info = (await exec.inspect()) as { ExitCode?: number };
  const exit = info.ExitCode ?? 1;
  return {
    exit,
    output: Buffer.concat(chunks).toString("utf8").slice(0, MAX_OUTPUT),
    // GNU timeout exits 124 when it killed the process.
    timedOut: exit === 124,
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function executeJob(
  job: CronJobRow,
  manual: boolean,
): Promise<{ runId: number; ok: boolean; exit: number | null; timedOut: boolean }> {
  const started = Date.now();
  let result: ExecResult;

  if (job.target_kind === "app") {
    const app = await one<{ container_id: string | null }>(
      "SELECT container_id FROM apps WHERE name = ?",
      [job.target_name ?? ""],
    );
    if (!app?.container_id) {
      result = { exit: null, output: `App "${job.target_name}" has no container.`, timedOut: false };
    } else {
      try {
        result = await execInContainer(app.container_id, job.command, job.timeout_sec);
      } catch (err) {
        result = {
          exit: null,
          output: `docker exec failed: ${err instanceof Error ? err.message : String(err)}`,
          timedOut: false,
        };
      }
    }
  } else {
    result = await execPanelCommand(job.command, job.timeout_sec);
  }

  const duration = Date.now() - started;
  const ok = result.timedOut ? false : result.exit === 0;
  const output = result.output.slice(-MAX_OUTPUT);

  const res = await execute(
    `INSERT INTO cron_runs(job_id, job_name, ts, exit_code, duration_ms, output, ok, timeout)
     VALUES (?,?,?,?,?,?,?,?)`,
    [job.id, job.name, started, result.exit, duration, output, ok ? 1 : 0, result.timedOut ? 1 : 0],
  );
  await execute(
    `UPDATE cron_jobs SET last_run_at = ?, last_status = ?, last_exit = ?, last_duration_ms = ? WHERE id = ?`,
    [started, ok ? "success" : result.timedOut ? "timeout" : "failed", result.exit, duration, job.id],
  );

  // Keep history bounded: 100 runs per job.
  await execute(
    `DELETE FROM cron_runs WHERE job_id = ? AND id NOT IN (
       SELECT id FROM (SELECT id FROM cron_runs WHERE job_id = ? ORDER BY ts DESC LIMIT 100) keep
     )`,
    [job.id, job.id],
  ).catch(() => {});

  void manual;
  return { runId: res.insertId, ok, exit: result.exit, timedOut: result.timedOut };
}

/**
 * Scheduler tick: run every job whose expression matches the current minute
 * and that has not already been recorded for this minute (idempotent).
 */
export async function runDueCronJobs(now = new Date()): Promise<void> {
  const jobs = await query<CronJobRow[]>("SELECT * FROM cron_jobs WHERE enabled = 1");
  const minuteStart = new Date(now.getTime());
  minuteStart.setSeconds(0, 0);
  const minuteTs = minuteStart.getTime();

  for (const job of jobs) {
    if (job.last_run_at && job.last_run_at >= minuteTs) continue; // already ran this minute
    if (!cronMatches(job.expression, now)) continue;
    try {
      const res = await executeJob(job, false);
      if (!res.ok) {
        await logActivity(
          "cron.run",
          `${job.name} failed (exit ${res.exit ?? "?"})${res.timedOut ? " — timed out" : ""}`,
          "scheduler",
          false,
        );
      }
    } catch {
      /* one bad job must not block the rest of the tick */
    }
  }
}

/** Next fire times for the UI (already computed with nextRuns). */
export function previewNextRuns(expression: string, count = 3): number[] {
  return nextRuns(expression, new Date(), count).map((d) => d.getTime());
}
