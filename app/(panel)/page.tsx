"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  Boxes,
  Cpu,
  Database,
  Globe2,
  HardDrive,
  MemoryStick,
  Plus,
  Server,
} from "lucide-react";
import { PageHeader } from "@/components/shell";
import { Badge, Card, Empty, Meter, StatusDot, cn } from "@/components/ui";
import { Sparkline } from "@/components/sparkline";
import { ago, usePanel } from "@/lib/client";
import type { MetricSample } from "@/lib/metrics";

type MetricsPayload = { range: string; series: MetricSample[] };

/** Poll /api/metrics once per minute for the dashboard charts. */
function useMetrics() {
  const [series, setSeries] = useState<MetricSample[]>([]);
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/metrics?range=24h", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as MetricsPayload;
        if (alive) setSeries(data.series ?? []);
      } catch {
        /* charts are best-effort */
      }
    }
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return series;
}

export default function OverviewPage() {
  const { state, loading } = usePanel();
  const series = useMetrics();

  if (loading || !state) {
    return <div className="h-64 animate-pulse rounded-2xl border border-white/5 bg-ink-900/40" />;
  }

  const { stats, apps, databases, domains } = state;
  const running = apps.filter((a) => a.status === "running").length;

  const cpuSeries = series.map((s) => s.cpu);
  const memSeries = series.map((s) => s.memPct);
  const diskSeries = series.map((s) => s.diskPct);

  const tones = (p: number) => (p > 88 ? "red" : p > 70 ? "amber" : "brand");

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`${stats.platform} · up ${stats.uptime}`}
        action={
          <div className="flex gap-2">
            <Link href="/apps">
              <span className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-500 px-4 text-sm font-medium text-ink-950 shadow-glow transition hover:bg-brand-400">
                <Plus size={15} /> New app
              </span>
            </Link>
          </div>
        }
      />

      {!stats.docker.ok && (
        <div className="mb-5 rounded-2xl border border-amber-500/25 bg-amber-500/[0.07] p-4 text-sm">
          <p className="font-medium text-amber-200">Docker is not reachable</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-200/70">
            {stats.docker.error} — start Docker and make sure the panel can read{" "}
            <code>/var/run/docker.sock</code>.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={<Cpu size={15} />}
          label="CPU"
          value={`${stats.cpu.percent}%`}
          sub={`${stats.cpu.cores} vCPU · load ${stats.cpu.load1}`}
          percent={stats.cpu.percent}
          tone={tones(stats.cpu.percent)}
          spark={cpuSeries}
        />
        <Stat
          icon={<MemoryStick size={15} />}
          label="Memory"
          value={`${stats.memory.usedMb} MB`}
          sub={`of ${stats.memory.totalMb} MB`}
          percent={stats.memory.percent}
          tone={tones(stats.memory.percent)}
          spark={memSeries}
        />
        <Stat
          icon={<HardDrive size={15} />}
          label="Disk"
          value={`${Math.round(stats.disk.usedGb)} GB`}
          sub={`of ${Math.round(stats.disk.totalGb)} GB`}
          percent={stats.disk.percent}
          tone={tones(stats.disk.percent)}
          spark={diskSeries}
        />
        <Stat
          icon={<Server size={15} />}
          label="Containers"
          value={`${stats.containers.running}/${stats.containers.total}`}
          sub={stats.docker.ok ? `Docker ${stats.docker.version}` : "docker offline"}
          percent={stats.containers.total ? (stats.containers.running / stats.containers.total) * 100 : 0}
          tone="brand"
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <MiniStat icon={<Boxes size={14} />} label="Apps running" value={`${running}/${apps.length}`} href="/apps" />
        <MiniStat icon={<Database size={14} />} label="Databases" value={String(databases.length)} href="/databases" />
        <MiniStat icon={<Globe2 size={14} />} label="Domains" value={String(domains.length)} href="/domains" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Applications</h2>
            <Link href="/apps" className="text-xs text-slate-400 transition hover:text-brand-400">
              Manage →
            </Link>
          </div>

          {apps.length === 0 ? (
            <Empty
              title="No applications yet"
              hint="Deploy PHP, Node.js or a static site in a few seconds."
              action={
                <Link
                  href="/apps"
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-white/5 px-3 text-xs text-slate-200 hover:bg-white/10"
                >
                  <Plus size={14} /> Create your first app
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-white/5">
              {apps.slice(0, 6).map((app) => (
                <li key={app.id} className="flex items-center gap-3 py-2.5">
                  <StatusDot ok={app.status === "running"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-200">{app.name}</p>
                    <p className="truncate text-[11px] text-slate-500">
                      {app.image} · :{app.port}
                      {app.domain ? ` · ${app.domain}` : ""}
                    </p>
                  </div>
                  <Badge tone={app.status === "running" ? "ok" : app.status === "error" ? "bad" : "neutral"}>
                    {app.status}
                  </Badge>
                  <Link
                    href="/apps"
                    className="rounded-lg p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-white"
                    aria-label="Open app"
                  >
                    <ArrowUpRight size={14} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <Activity size={14} className="text-brand-400" />
            <h2 className="text-sm font-semibold text-white">Recent activity</h2>
          </div>
          {state.activity.length === 0 ? (
            <p className="py-8 text-center text-xs text-slate-500">Nothing has happened yet.</p>
          ) : (
            <ol className="space-y-2.5">
              {state.activity.slice(0, 8).map((row) => (
                <li key={row.id} className="flex gap-2.5 text-xs">
                  <span
                    className={cn(
                      "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                      row.ok ? "bg-brand-400" : "bg-red-400",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-slate-300">
                      <span className="font-mono text-[10px] text-slate-500">{row.action}</span>{" "}
                      {row.detail}
                    </p>
                    <p className="text-[10px] text-slate-600">
                      {row.actor} · {ago(row.ts)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  percent,
  tone,
  spark,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  percent: number;
  tone: "brand" | "amber" | "red";
  spark?: number[];
}) {
  const stroke = tone === "red" ? "#f87171" : tone === "amber" ? "#fbbf24" : "#34d399";
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between text-slate-400">
        <span className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide">
          {icon}
          {label}
        </span>
        {spark && spark.length > 1 && (
          <span className="text-[10px] text-slate-600">24h</span>
        )}
      </div>
      <div>
        <p className="text-2xl font-semibold tracking-tight text-white">{value}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>
      </div>
      <div className="flex items-end gap-3">
        <Meter value={percent} tone={tone} />
        {spark && <Sparkline values={spark} width={96} height={30} className="shrink-0" stroke={stroke} />}
      </div>
    </Card>
  );
}

function MiniStat({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="flex items-center gap-3 transition hover:border-white/10 hover:bg-ink-850/60">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-brand-400">
          {icon}
        </span>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
          <p className="text-sm font-semibold text-white">{value}</p>
        </div>
      </Card>
    </Link>
  );
}
