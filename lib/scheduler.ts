/**
 * Background scheduler for the panel process (Next.js `register` hook in
 * instrumentation.ts). Runs lightweight maintenance ticks that must never
 * take synchronous DDL or heavy work:
 *   - due cron jobs (runDueCronJobs, once per minute, idempotent)
 *   - resource metric sampling
 *   - pruning: sessions, login attempts, phpMyAdmin tokens, metrics, backups
 *   - one-time provisioning: ensure the limited phpMyAdmin MySQL user exists
 *
 * Everything is best-effort: a failing tick logs and moves on.
 */
import { execute } from "./db";
import { runDueCronJobs } from "./cron-engine";
import { recordSample, pruneMetrics } from "./metrics";
import { pruneLoginAttempts } from "./ratelimit";
import { prunePmaTokens } from "./pma";
import { applyRetention, sweepOrphanFiles } from "./backup";
import { systemStats } from "./stats";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // sessions revoked after 30 days

let lastCronTick = 0;
let lastHourPrune = 0;
let pmaUserProvisioned = false;

async function pruneDockerResources(): Promise<void> {
  try {
    const { docker } = await import("./docker");
    // Prune dangling images (<none>) and stopped one-off containers to save disk space
    await docker.pruneImages({ filters: { dangling: { true: true } } }).catch(() => {});
    await docker.pruneContainers().catch(() => {});
  } catch {
    /* docker socket not available or tests */
  }
}

async function pruneSessions(): Promise<void> {
  try {
    await execute("DELETE FROM sessions WHERE expires_at < ?", [Date.now()]);
  } catch {
    /* ignore */
  }
}

/**
 * One scheduler tick. `now` and `forcePmaProvision` are overridable so the
 * pure flow can be unit-tested without Docker or a live DB.
 */
export async function schedulerTick(opts?: { now?: Date; skipStats?: boolean }): Promise<void> {
  const now = opts?.now ?? new Date();
  const minuteTs = now.getTime();
  const nowMs = minuteTs;

  // Cron due-check: once per wall-clock minute.
  if (nowMs - lastCronTick >= 60_000) {
    lastCronTick = nowMs;
    await runDueCronJobs(now).catch(() => {});
  }

  if (!opts?.skipStats) {
    await recordSample(await systemStats()).catch(() => {});
  }

  await pruneSessions().catch(() => {});
  await pruneLoginAttempts().catch(() => {});
  await prunePmaTokens().catch(() => {});
  await pruneMetrics().catch(() => {});
  await sweepOrphanFiles().catch(() => {});

  // Hourly disk sweep: keep max 3 backups per target and clean dangling docker images
  if (nowMs - lastHourPrune >= 3600_000) {
    lastHourPrune = nowMs;
    await applyRetention(3).catch(() => {});
    await pruneDockerResources().catch(() => {});
  }

  // Provision the limited phpMyAdmin user once on startup (best-effort).
  if (!pmaUserProvisioned) {
    pmaUserProvisioned = true;
    try {
      const { ensurePmaUser } = await import("./mysqladmin");
      await ensurePmaUser();
    } catch {
      pmaUserProvisioned = false; // retry next tick
    }
  }
}