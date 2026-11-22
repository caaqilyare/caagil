"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui";

export type JobStep = {
  key: string;
  label: string;
  status: "pending" | "active" | "done" | "error";
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

/** Polls /api/jobs/<id> until the job settles. */
export function useJob(jobId: string | null, onDone?: (job: Job) => void): Job | null {
  const [job, setJob] = useState<Job | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as Job;
          if (stopped) return;
          setJob(data);
          if (data.status !== "running") {
            if (data.status === "done") doneRef.current?.(data);
            return;
          }
        } else if (res.status === 404) {
          if (!stopped) setJob(null);
          return; // job lost (panel restarted) — stop polling
        }
      } catch {
        /* transient network error — keep polling */
      }
      if (!stopped) timer = setTimeout(poll, 900);
    }

    setJob(null);
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [jobId]);

  return job;
}

export function JobProgress({
  job,
  onBack,
  backLabel = "Back",
  children,
}: {
  job: Job | null;
  onBack?: () => void;
  backLabel?: string;
  /** Rendered on the success screen (links, next actions). */
  children?: ReactNode;
}) {
  if (job?.status === "done") {
    return (
      <div className="animate-fade-up space-y-4 py-2">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 animate-pop items-center justify-center rounded-full bg-emerald-500/15 ring-1 ring-emerald-500/40">
            <CheckCircle2 size={24} className="text-emerald-400" />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">Deployment complete</p>
            <p className="text-[11px] text-slate-500">
              {job.steps.length} steps ·{" "}
              {Math.max(
                1,
                Math.round(((job.finishedAt ?? Date.now()) - job.createdAt) / 1000),
              )}{" "}
              seconds
            </p>
          </div>
        </div>
        {children}
      </div>
    );
  }

  if (job?.status === "error") {
    return (
      <div className="animate-fade-up space-y-4 py-2">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 animate-pop items-center justify-center rounded-full bg-red-500/15 ring-1 ring-red-500/40">
            <XCircle size={24} className="text-red-400" />
          </span>
          <div>
            <p className="text-sm font-semibold text-white">Deployment failed</p>
            <p className="text-[11px] text-slate-500">{job.error}</p>
          </div>
        </div>
        <ul className="space-y-2">
          {job.steps.map((step) => (
            <StepRow key={step.key} step={step} />
          ))}
        </ul>
        {onBack && (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={onBack}>
              {backLabel}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const steps = job?.steps ?? [];
  const done = steps.filter((s) => s.status === "done").length;
  const active = steps.find((s) => s.status === "active");
  const pct = job
    ? Math.min(96, Math.round(((done + (active ? 0.5 : 0)) / Math.max(steps.length, 1)) * 100))
    : 0;

  return (
    <div className="animate-fade-up space-y-4 py-2">
      <div className="flex items-center justify-between text-[11px] text-slate-500">
        <span className="flex items-center gap-2">
          <Loader2 size={13} className="animate-spin text-brand-400" />
          {job?.title ?? "Preparing deployment…"}
        </span>
        <span className="font-mono">{pct}%</span>
      </div>

      <div className="relative h-2 overflow-hidden rounded-full bg-white/5">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-brand-400 to-sky-400 transition-all duration-700 ease-out"
          style={{ width: `${pct}%` }}
        />
        {job && (
          <div className="absolute inset-y-0 w-1/3 animate-shimmer bg-gradient-to-r from-transparent via-white/20 to-transparent" />
        )}
      </div>

      <ul className="space-y-1.5">
        {steps.length === 0 && (
          <li className="flex items-center gap-3 rounded-xl bg-ink-950/50 px-3 py-2.5 text-sm text-slate-400">
            <Loader2 size={15} className="animate-spin text-brand-400" /> Connecting to the deploy
            queue…
          </li>
        )}
        {steps.map((step, i) => (
          <StepRow key={step.key} step={step} index={i} />
        ))}
      </ul>
    </div>
  );
}

function StepRow({ step, index = 0 }: { step: JobStep; index?: number }) {
  return (
    <li
      className={`animate-fade-up flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
        step.status === "active"
          ? "bg-brand-500/10 ring-1 ring-brand-500/25"
          : "bg-ink-950/40"
      }`}
      style={{ animationDelay: `${Math.min(index * 60, 400)}ms` }}
    >
      {step.status === "done" && (
        <CheckCircle2 size={16} className="animate-pop shrink-0 text-emerald-400" />
      )}
      {step.status === "active" && (
        <Loader2 size={16} className="shrink-0 animate-spin text-brand-400" />
      )}
      {step.status === "error" && <XCircle size={16} className="shrink-0 text-red-400" />}
      {step.status === "pending" && (
        <span className="mx-[3px] h-2.5 w-2.5 shrink-0 rounded-full border border-slate-600" />
      )}
      <span
        className={
          step.status === "active"
            ? "font-medium text-white"
            : step.status === "pending"
              ? "text-slate-500"
              : step.status === "error"
                ? "text-red-300"
                : "text-slate-300"
        }
      >
        {step.label}
      </span>
      {step.detail && (
        <span className="ml-auto max-w-[45%] truncate font-mono text-[10.5px] text-slate-500">
          {step.detail}
        </span>
      )}
    </li>
  );
}
