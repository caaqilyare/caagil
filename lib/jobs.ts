/**
 * Lightweight in-memory job tracker for long-running panel operations
 * (app deploys, WordPress installs). The UI polls /api/jobs/<id> to render
 * live step-by-step progress. Jobs are process-local and short-lived.
 */

export type JobStepStatus = "pending" | "active" | "done" | "error";

export type JobStep = {
  key: string;
  label: string;
  status: JobStepStatus;
  detail?: string;
};

export type Job = {
  id: string;
  kind: string;
  title: string;
  steps: JobStep[];
  status: "running" | "done" | "error";
  error?: string;
  result?: unknown;
  createdAt: number;
  finishedAt?: number;
};

const store = new Map<string, Job>();

function cleanup() {
  const entries = [...store.values()].sort((a, b) => b.createdAt - a.createdAt);
  for (const job of entries.slice(200)) store.delete(job.id);
  const hourAgo = Date.now() - 60 * 60 * 1000;
  for (const job of store.values()) {
    if (job.finishedAt && job.finishedAt < hourAgo) store.delete(job.id);
  }
}

export function createJob(
  kind: string,
  title: string,
  steps: { key: string; label: string }[],
): string {
  const id = `job_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  store.set(id, {
    id,
    kind,
    title,
    steps: steps.map((s) => ({ ...s, status: "pending" as JobStepStatus })),
    status: "running",
    createdAt: Date.now(),
  });
  cleanup();
  return id;
}

export function jobStep(
  id: string,
  key: string,
  status: "active" | "done" | "error",
  detail?: string,
): void {
  const job = store.get(id);
  if (!job) return;
  const step = job.steps.find((s) => s.key === key);
  if (step) {
    step.status = status;
    if (detail !== undefined) step.detail = detail;
  }
  if (status === "error") {
    job.status = "error";
    job.error = detail || job.error || `${key} failed`;
    job.finishedAt = Date.now();
  }
}

export function jobFinish(id: string, result?: unknown): void {
  const job = store.get(id);
  if (!job) return;
  for (const step of job.steps) {
    if (step.status === "active" || step.status === "pending") step.status = "done";
  }
  job.status = "done";
  job.result = result;
  job.finishedAt = Date.now();
}

export function jobFail(id: string, error: string): void {
  const job = store.get(id);
  if (!job) return;
  job.status = "error";
  job.error = error;
  job.finishedAt = Date.now();
  for (const step of job.steps) {
    if (step.status === "active") step.status = "error";
  }
}

export function getJob(id: string): Job | null {
  return store.get(id) ?? null;
}
