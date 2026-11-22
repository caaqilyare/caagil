import os from "node:os";
import fs from "node:fs/promises";
import { docker } from "./docker";

export type SystemStats = {
  cpu: { cores: number; load1: number; percent: number };
  memory: { totalMb: number; usedMb: number; percent: number };
  disk: { totalGb: number; usedGb: number; percent: number };
  uptime: string;
  platform: string;
  containers: { total: number; running: number };
  docker: { ok: boolean; error?: string; version?: string };
};

function humanUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function cpuTimes() {
  return os.cpus().reduce(
    (acc, cpu) => {
      const t = cpu.times;
      acc.idle += t.idle;
      acc.total += t.user + t.nice + t.sys + t.idle + t.irq;
      return acc;
    },
    { idle: 0, total: 0 },
  );
}

export async function systemStats(): Promise<SystemStats> {
  const before = cpuTimes();
  await new Promise((r) => setTimeout(r, 200));
  const after = cpuTimes();
  const idle = after.idle - before.idle;
  const total = after.total - before.total;
  const cpuPercent = total > 0 ? Math.round((1 - idle / total) * 100) : 0;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  let disk = { totalGb: 0, usedGb: 0, percent: 0 };
  try {
    const st = await fs.statfs(process.env.DATA_DIR || "/");
    const totalBytes = Number(st.blocks) * Number(st.bsize);
    const freeBytes = Number(st.bavail) * Number(st.bsize);
    disk = {
      totalGb: Math.round((totalBytes / 1e9) * 10) / 10,
      usedGb: Math.round(((totalBytes - freeBytes) / 1e9) * 10) / 10,
      percent: totalBytes ? Math.round(((totalBytes - freeBytes) / totalBytes) * 100) : 0,
    };
  } catch {
    /* ignore */
  }

  let containers = { total: 0, running: 0 };
  let dockerState: SystemStats["docker"] = { ok: false };
  try {
    await docker.ping();
    const version = await docker.version();
    const list = await docker.listContainers({ all: true });
    containers = {
      total: list.length,
      running: list.filter((c) => c.State === "running").length,
    };
    dockerState = { ok: true, version: version.Version };
  } catch (err) {
    dockerState = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  return {
    cpu: {
      cores: os.cpus().length,
      load1: Math.round(os.loadavg()[0] * 100) / 100,
      percent: cpuPercent,
    },
    memory: {
      totalMb: Math.round(totalMem / 1024 / 1024),
      usedMb: Math.round(usedMem / 1024 / 1024),
      percent: Math.round((usedMem / totalMem) * 100),
    },
    disk,
    uptime: humanUptime(os.uptime()),
    platform: `${os.type()} ${os.release()}`,
    containers,
    docker: dockerState,
  };
}
