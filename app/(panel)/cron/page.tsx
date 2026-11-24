"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Clock,
  History,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
  Zap,
} from "lucide-react";
import { PageHeader } from "@/components/shell";
import { Badge, Button, Card, Code, Empty, Field, Input, Modal, Select } from "@/components/ui";
import { usePanel, ago } from "@/lib/client";

type CronJob = {
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
};

type CronRun = {
  id: number;
  job_name: string;
  ts: number;
  exit_code: number | null;
  duration_ms: number | null;
  output: string | null;
  ok: number;
  timeout: number;
};

const PRESETS = [
  { label: "Every 5 minutes", expression: "*/5 * * * *" },
  { label: "Every 15 minutes", expression: "*/15 * * * *" },
  { label: "Every hour", expression: "0 * * * *" },
  { label: "Every 6 hours", expression: "0 */6 * * *" },
  { label: "Daily at 03:00", expression: "0 3 * * *" },
  { label: "Weekly (Sun 04:00)", expression: "0 4 * * 0" },
  { label: "Monthly (1st, 05:00)", expression: "0 5 1 * *" },
];

export default function CronPage() {
  const { state, act } = usePanel();
  const [jobs, setJobs] = useState<CronJob[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [historyFor, setHistoryFor] = useState<CronJob | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await act<{ jobs: CronJob[] }>("cron.list");
      setJobs(res.jobs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setJobs([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(key: string, action: string, payload: Record<string, unknown> = {}) {
    setBusy(key);
    setError(null);
    try {
      await act(action, payload);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Cron jobs"
        subtitle="Scheduled tasks inside the panel container or in any app container."
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => refresh()}>
              <RefreshCw size={14} /> Refresh
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> New task
            </Button>
          </div>
        }
      />

      {error && (
        <p className="mb-4 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {!jobs ? (
        <div className="h-52 animate-pulse rounded-2xl border border-white/5 bg-ink-900/40" />
      ) : jobs.length === 0 ? (
        <Empty
          title="No scheduled tasks"
          hint="Create a cron job to run database dumps, cache warmups or any command on a schedule."
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> Create task
            </Button>
          }
        />
      ) : (
        <div className="space-y-2.5">
          {jobs.map((job) => (
            <Card key={job.id} className="space-y-2.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-brand-400">
                    <Clock size={15} />
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Status ok={Boolean(job.enabled)} />
                      <h3 className="text-sm font-semibold text-white">{job.name}</h3>
                      <Badge tone="info">
                        <Code>{job.expression}</Code>
                      </Badge>
                      <Badge tone="neutral">
                        {job.target_kind === "app" ? `in ${job.target_name}` : "panel"}
                      </Badge>
                    </div>
                    <p className="mt-1 max-w-xl truncate font-mono text-[11px] text-slate-500">
                      {job.command}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-600">
                      {job.last_run_at
                        ? `last run ${ago(job.last_run_at)} · ${
                            job.last_status ?? "?"
                          } (exit ${job.last_exit ?? "?"}, ${job.last_duration_ms ?? "?"} ms)`
                        : "never run yet"}
                      {` · timeout ${job.timeout_sec}s`}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Run now"
                    loading={busy === `run-${job.id}`}
                    onClick={() => run(`run-${job.id}`, "cron.run", { id: job.id })}
                  >
                    <Zap size={13} /> Run
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title={job.enabled ? "Pause" : "Resume"}
                    loading={busy === `toggle-${job.id}`}
                    onClick={() =>
                      run(`toggle-${job.id}`, "cron.update", { id: job.id, enabled: !job.enabled })
                    }
                  >
                    {job.enabled ? <Pause size={13} /> : <Play size={13} />}
                  </Button>
                  <Button
                    size="sm"
                    variant="subtle"
                    title="History"
                    onClick={() => setHistoryFor(job)}
                  >
                    <History size={13} />
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy === `del-${job.id}`}
                    onClick={() => {
                      if (confirm(`Delete task "${job.name}" and its history?`)) {
                        void run(`del-${job.id}`, "cron.delete", { id: job.id });
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CreateJobModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        apps={(state?.apps ?? []).map((a) => a.name)}
        onCreate={async (payload) => {
          await run("create", "cron.create", payload);
          setCreateOpen(false);
        }}
      />

      <HistoryModal job={historyFor} onClose={() => setHistoryFor(null)} act={act} />
    </>
  );
}

function Status({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${ok ? "bg-emerald-400" : "bg-slate-600"}`}
      title={ok ? "enabled" : "paused"}
    />
  );
}

function CreateJobModal({
  open,
  onClose,
  apps,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  apps: string[];
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState({
    name: "",
    expression: "0 3 * * *",
    targetKind: "panel" as "panel" | "app",
    targetName: apps[0] ?? "",
    command: "",
    timeoutSec: "300",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        name: form.name,
        expression: form.expression,
        targetKind: form.targetKind,
        targetName: form.targetKind === "app" ? form.targetName : undefined,
        command: form.command,
        timeoutSec: Number(form.timeoutSec) || 300,
      });
      setForm((f) => ({ ...f, name: "", command: "" }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New scheduled task"
      description="5-field cron expression, executed once per matched minute."
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={form.name} onChange={set("name")} placeholder="Nightly backup" required />
          </Field>
          <Field label="Preset">
            <Select
              value=""
              onChange={(e) => {
                if (e.target.value) setForm((f) => ({ ...f, expression: e.target.value }));
              }}
            >
              <option value="">Choose a schedule…</option>
              {PRESETS.map((p) => (
                <option key={p.expression} value={p.expression}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Cron expression" hint="minute hour day month weekday — e.g. */15 * * * *">
          <Input value={form.expression} onChange={set("expression")} required />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Run in">
            <Select value={form.targetKind} onChange={set("targetKind")}>
              <option value="panel">Panel container</option>
              <option value="app">App container</option>
            </Select>
          </Field>
          {form.targetKind === "app" && (
            <Field label="App">
              <Select value={form.targetName} onChange={set("targetName")}>
                {apps.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        <Field label="Command" hint="sh -lc — e.g. php /app/bin/console cache:clear">
          <Input value={form.command} onChange={set("command")} required />
        </Field>

        <Field label="Timeout (seconds)">
          <Input type="number" min={5} max={3600} value={form.timeoutSec} onChange={set("timeoutSec")} />
        </Field>

        {error && (
          <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={busy}>
            <Plus size={13} /> Create task
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function HistoryModal({
  job,
  onClose,
  act,
}: {
  job: CronJob | null;
  onClose: () => void;
  act: <T = unknown>(action: string, payload?: Record<string, unknown>) => Promise<T>;
}) {
  const [runs, setRuns] = useState<CronRun[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!job) return;
    setRuns(null);
    void act<{ runs: CronRun[] }>("cron.history", { id: job.id, limit: 50 })
      .then((res) => setRuns(res.runs))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);

  return (
    <Modal
      open={Boolean(job)}
      onClose={onClose}
      title={`Run history · ${job?.name ?? ""}`}
      description="Most recent 50 executions of this task."
      wide
    >
      {error && (
        <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}
      {!runs ? (
        <div className="h-32 animate-pulse rounded-xl bg-white/5" />
      ) : runs.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-slate-500">This task has not run yet.</p>
      ) : (
        <div className="max-h-[50vh] space-y-2 overflow-y-auto">
          {runs.map((r) => (
            <details key={r.id} className="rounded-xl border border-white/5 bg-ink-950/40 px-3 py-2">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-xs">
                <Badge tone={r.ok ? "ok" : "bad"}>
                  {r.ok ? "ok" : r.timeout ? "timeout" : `exit ${r.exit_code ?? "?"}`}
                </Badge>
                <span className="text-slate-300">{new Date(r.ts).toLocaleString()}</span>
                <span className="ml-auto text-slate-500">
                  {ago(r.ts)} · {r.duration_ms ?? "?"} ms
                </span>
              </summary>
              {r.output && (
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-2.5 font-mono text-[11px] text-slate-400">
                  {r.output}
                </pre>
              )}
            </details>
          ))}
        </div>
      )}
    </Modal>
  );
}
