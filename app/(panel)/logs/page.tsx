"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Filter, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shell";
import { Badge, Button, Card, Code, Empty } from "@/components/ui";
import { ago } from "@/lib/client";

type ActivityRow = {
  id: number;
  action: string;
  detail: string | null;
  actor: string | null;
  ok: number;
  ts: number;
};

type CronFailure = {
  jobName: string;
  ts: number;
  exitCode: number | null;
  output: string | null;
};

export default function LogsPage() {
  const [activity, setActivity] = useState<ActivityRow[] | null>(null);
  const [cronFailures, setCronFailures] = useState<CronFailure[]>([]);
  const [level, setLevel] = useState<"all" | "errors">("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/logs?level=${level}&limit=300`, { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error("Could not load logs.");
      const data = (await res.json()) as { activity: ActivityRow[]; cronFailures: CronFailure[] };
      setActivity(data.activity);
      setCronFailures(data.cronFailures ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setActivity([]);
    }
  }, [level]);

  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const filtered = (activity ?? []).filter((row) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      row.action.toLowerCase().includes(q) ||
      (row.detail ?? "").toLowerCase().includes(q) ||
      (row.actor ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <>
      <PageHeader
        title="Logs"
        subtitle="Panel activity feed and failed scheduled-task output, auto-refreshing every 30s."
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={level === "errors" ? "primary" : "ghost"}
              onClick={() => setLevel(level === "all" ? "errors" : "all")}
            >
              <Filter size={14} /> {level === "all" ? "Errors only" : "All events"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => refresh()}>
              <RefreshCw size={14} /> Refresh
            </Button>
          </div>
        }
      />

      {error && (
        <p className="mb-4 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {cronFailures.length > 0 && (
        <Card className="mb-5 border-amber-500/20 bg-amber-500/[0.04]">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-300">
            <AlertTriangle size={14} /> Failed cron runs ({cronFailures.length})
          </h2>
          <div className="max-h-52 space-y-2 overflow-y-auto">
            {cronFailures.map((f, i) => (
              <details key={`${f.ts}-${i}`} className="rounded-lg border border-amber-500/10 bg-black/20 px-3 py-2">
                <summary className="cursor-pointer text-xs text-slate-300">
                  <Code>{f.jobName}</Code> · exit {f.exitCode ?? "?"} · {ago(f.ts)}
                </summary>
                {f.output && (
                  <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-slate-500">
                    {f.output}
                  </pre>
                )}
              </details>
            ))}
          </div>
        </Card>
      )}

      <div className="mb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by action, detail or actor…"
          className="w-full rounded-xl border border-white/10 bg-ink-950/60 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-brand-500/50"
        />
      </div>

      {!activity ? (
        <div className="h-52 animate-pulse rounded-2xl border border-white/5 bg-ink-900/40" />
      ) : filtered.length === 0 ? (
        <Empty
          title="No log entries"
          hint={query ? "Nothing matches the current filter." : "Panel actions will appear here."}
        />
      ) : (
        <Card className="divide-y divide-white/5 p-0">
          {filtered.map((row) => (
            <div key={row.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3.5 py-2.5">
              <span className="w-32 shrink-0 text-[11px] text-slate-500" title={new Date(row.ts).toLocaleString()}>
                {ago(row.ts)}
              </span>
              <Badge tone={row.ok ? "neutral" : "bad"}>{row.action}</Badge>
              <span className="min-w-0 flex-1 break-words text-xs text-slate-300">
                {row.detail || "—"}
              </span>
              <span className="text-[11px] text-slate-500">{row.actor ?? "system"}</span>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}
