"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  Archive,
  ArrowUpRight,
  Boxes,
  Check,
  Clock,
  Copy,
  Cpu,
  Database,
  Globe2,
  HardDrive,
  Layers,
  MemoryStick,
  Plus,
  Server,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { Badge, Empty, StatusDot, cn } from "@/components/ui";
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
  const [copiedIp, setCopiedIp] = useState(false);

  if (loading || !state) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-28 rounded-3xl border border-white/5 bg-ink-900/30 backdrop-blur-xl" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-44 rounded-2xl border border-white/5 bg-ink-900/30 backdrop-blur-xl" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="h-96 rounded-2xl border border-white/5 bg-ink-900/30 lg:col-span-3 backdrop-blur-xl" />
          <div className="h-96 rounded-2xl border border-white/5 bg-ink-900/30 lg:col-span-2 backdrop-blur-xl" />
        </div>
      </div>
    );
  }

  const { stats, apps, databases, domains, publicIp } = state;
  const running = apps.filter((a) => a.status === "running").length;

  const cpuSeries = series.map((s) => s.cpu);
  const memSeries = series.map((s) => s.memPct);
  const diskSeries = series.map((s) => s.diskPct);

  const tones = (p: number): "brand" | "amber" | "red" =>
    p > 88 ? "red" : p > 70 ? "amber" : "brand";

  function copyIp() {
    if (!publicIp) return;
    navigator.clipboard.writeText(publicIp);
    setCopiedIp(true);
    setTimeout(() => setCopiedIp(false), 2000);
  }

  return (
    <div className="relative space-y-6 pb-12">
      {/* Decorative ambient background glows behind glass */}
      <div className="pointer-events-none absolute -top-16 left-1/4 h-80 w-80 rounded-full bg-brand-500/10 blur-[100px]" />
      <div className="pointer-events-none absolute top-40 right-10 h-72 w-72 rounded-full bg-sky-500/10 blur-[100px]" />
      <div className="pointer-events-none absolute top-96 left-10 h-64 w-64 rounded-full bg-purple-500/10 blur-[110px]" />

      {/* Hero Glass Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-white/[0.09] via-white/[0.04] to-white/[0.02] p-6 sm:p-7 shadow-[0_16px_50px_0_rgba(0,0,0,0.5),inset_0_1px_1px_0_rgba(255,255,255,0.25)] backdrop-blur-3xl">
        {/* Subtle glass reflection highlight on top */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent" />
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-brand-400/15 via-sky-400/10 to-transparent blur-3xl" />

        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-medium text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.2)] backdrop-blur-md">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                System Operational
              </span>

              {publicIp && (
                <button
                  onClick={copyIp}
                  className="group inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] font-mono text-slate-300 transition-all hover:border-white/20 hover:bg-white/[0.08]"
                  title="Click to copy IP"
                >
                  <Server size={11} className="text-slate-400" />
                  <span>{publicIp}</span>
                  {copiedIp ? (
                    <Check size={11} className="text-emerald-400" />
                  ) : (
                    <Copy size={11} className="text-slate-500 opacity-0 group-hover:opacity-100 transition" />
                  )}
                </button>
              )}

              <span className="hidden text-xs text-slate-500 sm:inline">·</span>
              <span className="text-xs text-slate-400">Up {stats.uptime}</span>
            </div>

            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white drop-shadow-sm">
              Control Center
            </h1>
            <p className="text-xs sm:text-sm text-slate-300/80">
              {stats.platform} · {stats.cpu.cores} vCPU Core architecture · Next-gen cloud container host
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href="/assistant"
              className="glass-button h-10 px-4 text-xs font-semibold hover:border-purple-500/30 hover:bg-purple-500/10 hover:text-purple-200"
            >
              <Sparkles size={14} className="text-purple-400" />
              AI Operator
            </Link>
            <Link
              href="/apps"
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-brand-500 via-brand-400 to-emerald-400 px-4 text-xs font-bold text-ink-950 shadow-[0_0_24px_rgba(18,201,138,0.35)] transition-all duration-200 hover:shadow-[0_0_36px_rgba(18,201,138,0.55)] hover:scale-[1.02] active:scale-[0.98]"
            >
              <Plus size={15} strokeWidth={2.5} />
              Deploy App
            </Link>
          </div>
        </div>
      </div>

      {!stats.docker.ok && (
        <div className="relative overflow-hidden rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 backdrop-blur-xl">
          <div className="flex items-start gap-3">
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-2 text-amber-300">
              <Zap size={18} />
            </div>
            <div>
              <p className="font-semibold text-amber-200">Docker Engine Not Reachable</p>
              <p className="mt-1 text-xs text-amber-200/80 leading-relaxed">
                {stats.docker.error} — ensure Docker is running and the panel can access <code>/var/run/docker.sock</code>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 4 Premium Glass Hardware Telemetry Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <GlassStat
          title="CPU Load"
          value={`${stats.cpu.percent}%`}
          subtitle={`${stats.cpu.cores} vCPUs · load ${stats.cpu.load1}`}
          percent={stats.cpu.percent}
          tone={tones(stats.cpu.percent)}
          spark={cpuSeries}
          icon={<Cpu size={18} />}
          glowColor="emerald"
          delay={0}
        />
        <GlassStat
          title="Memory RAM"
          value={`${stats.memory.usedMb} MB`}
          subtitle={`of ${(stats.memory.totalMb / 1024).toFixed(1)} GB total`}
          percent={stats.memory.percent}
          tone={tones(stats.memory.percent)}
          spark={memSeries}
          icon={<MemoryStick size={18} />}
          glowColor="sky"
          delay={0.06}
        />
        <GlassStat
          title="NVMe Storage"
          value={`${Math.round(stats.disk.usedGb)} GB`}
          subtitle={`of ${Math.round(stats.disk.totalGb)} GB capacity`}
          percent={stats.disk.percent}
          tone={tones(stats.disk.percent)}
          spark={diskSeries}
          icon={<HardDrive size={18} />}
          glowColor="purple"
          delay={0.12}
        />
        <GlassStat
          title="Docker Containers"
          value={`${stats.containers.running} / ${stats.containers.total}`}
          subtitle={stats.docker.ok ? `Engine v${stats.docker.version}` : "Docker Offline"}
          percent={stats.containers.total ? (stats.containers.running / stats.containers.total) * 100 : 0}
          tone="brand"
          icon={<Layers size={18} />}
          glowColor="teal"
          showBadge={`${stats.containers.running} active`}
          delay={0.18}
        />
      </div>

      {/* Quick Nav Ribbon - Sleek Glass Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <GlassQuickTab
          icon={<Boxes size={17} />}
          label="Applications"
          value={`${running} running`}
          extra={`${apps.length} total`}
          href="/apps"
          color="emerald"
        />
        <GlassQuickTab
          icon={<Database size={17} />}
          label="Databases"
          value={`${databases.length} active`}
          extra="MySQL 8.4"
          href="/databases"
          color="cyan"
        />
        <GlassQuickTab
          icon={<Globe2 size={17} />}
          label="Domains & SSL"
          value={`${domains.length} configured`}
          extra="Let's Encrypt"
          href="/domains"
          color="indigo"
        />
        <GlassQuickTab
          icon={<Archive size={17} />}
          label="Backups & Cron"
          value="Automated"
          extra="Scheduled daily"
          href="/backups"
          color="amber"
        />
      </div>

      {/* Main Glass Split: Applications Hub & System Activity Feed */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Left Column: Applications Table Glass Card */}
        <div className="relative overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-b from-white/[0.07] via-white/[0.03] to-white/[0.01] p-6 backdrop-blur-3xl shadow-[0_16px_50px_0_rgba(0,0,0,0.5),inset_0_1px_1px_0_rgba(255,255,255,0.22)] lg:col-span-3">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent" />

          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-brand-400/20 bg-brand-400/10 text-brand-400 shadow-[0_0_12px_rgba(52,224,161,0.2)]">
                <Boxes size={16} />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-white tracking-wide">
                  Deployed Applications
                </h2>
                <p className="text-[11px] text-slate-400">Isolated Docker container environments</p>
              </div>
            </div>

            <Link
              href="/apps"
              className="group inline-flex items-center gap-1 text-xs font-medium text-slate-400 transition hover:text-brand-300"
            >
              <span>Manage all</span>
              <ArrowUpRight size={13} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>

          {apps.length === 0 ? (
            <div className="rounded-2xl border border-white/5 bg-white/[0.02] p-8 text-center backdrop-blur-md">
              <Empty
                title="No applications deployed yet"
                hint="Launch WordPress, Node.js, PHP, or custom static sites in seconds."
                action={
                  <Link
                    href="/apps"
                    className="glass-button h-9 px-4 text-xs font-semibold text-brand-300 hover:border-brand-500/30 hover:bg-brand-500/10"
                  >
                    <Plus size={14} /> Create your first app
                  </Link>
                }
              />
            </div>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {apps.slice(0, 6).map((app) => (
                <div
                  key={app.id}
                  className="group flex items-center gap-3.5 py-3 transition-colors hover:bg-white/[0.02] -mx-2 px-2 rounded-xl"
                >
                  <StatusDot ok={app.status === "running"} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-slate-100 group-hover:text-white">
                        {app.name}
                      </p>
                      {app.domain && (
                        <span className="hidden sm:inline rounded-md border border-white/5 bg-white/[0.04] px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
                          {app.domain}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[11px] font-mono text-slate-400">
                      {app.image} · port <span className="text-slate-300">:{app.port}</span>
                    </p>
                  </div>

                  <Badge
                    tone={
                      app.status === "running"
                        ? "ok"
                        : app.status === "error"
                          ? "bad"
                          : "neutral"
                    }
                  >
                    {app.status}
                  </Badge>

                  <div className="flex items-center gap-1">
                    {app.domain ? (
                      <a
                        href={`https://${app.domain}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-white/5 bg-white/[0.03] p-1.5 text-slate-400 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
                        title="Open Website"
                      >
                        <ArrowUpRight size={14} />
                      </a>
                    ) : (
                      <Link
                        href="/apps"
                        className="rounded-lg border border-white/5 bg-white/[0.03] p-1.5 text-slate-400 transition hover:border-white/20 hover:bg-white/10 hover:text-white"
                        title="Manage App"
                      >
                        <ArrowUpRight size={14} />
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Live Activity Feed Glass Card */}
        <div className="relative overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-b from-white/[0.07] via-white/[0.03] to-white/[0.01] p-6 backdrop-blur-3xl shadow-[0_16px_50px_0_rgba(0,0,0,0.5),inset_0_1px_1px_0_rgba(255,255,255,0.22)] lg:col-span-2">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent" />

          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-400/10 text-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.2)]">
                <Activity size={16} />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-white tracking-wide">
                  Live Audit Trail
                </h2>
                <p className="text-[11px] text-slate-400">Host actions & system telemetry</p>
              </div>
            </div>

            <Link
              href="/logs"
              className="text-xs text-slate-400 transition hover:text-sky-300"
            >
              View logs →
            </Link>
          </div>

          {state.activity.length === 0 ? (
            <div className="py-12 text-center text-xs text-slate-500">
              No recent activity recorded.
            </div>
          ) : (
            <div className="relative space-y-3 before:absolute before:bottom-2 before:left-[7px] before:top-2 before:w-[1px] before:bg-white/[0.08]">
              {state.activity.slice(0, 7).map((row) => (
                <div key={row.id} className="relative flex items-start gap-3 pl-5 text-xs">
                  <span
                    className={cn(
                      "absolute left-[5px] top-1.5 h-1.5 w-1.5 rounded-full ring-4 ring-ink-950",
                      row.ok
                        ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,224,161,0.8)]"
                        : "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.8)]",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-200">
                      <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-brand-300">
                        {row.action}
                      </span>{" "}
                      {row.detail}
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      {row.actor} · {ago(row.ts)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Quick System Specs badge at bottom */}
          <div className="mt-6 rounded-2xl border border-white/5 bg-white/[0.02] p-3 text-xs backdrop-blur-md">
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-300">
                <ShieldCheck size={13} className="text-emerald-400" /> Hardened Traefik Edge
              </span>
              <span className="text-[10px] font-mono text-slate-500">Port 80/443 SSL</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** High-tech Frosted Glass Telemetry Card with SVG Area Sparkline */
function GlassStat({
  title,
  value,
  subtitle,
  percent,
  tone,
  spark,
  icon,
  glowColor,
  showBadge,
  delay = 0,
}: {
  title: string;
  value: string;
  subtitle: string;
  percent: number;
  tone: "brand" | "amber" | "red";
  spark?: number[];
  icon: React.ReactNode;
  glowColor: "emerald" | "sky" | "purple" | "teal";
  showBadge?: string;
  delay?: number;
}) {
  const reduceMotion = useReducedMotion();
  const glowMap = {
    emerald: "from-emerald-500/15 via-emerald-500/5 to-transparent",
    sky: "from-sky-500/15 via-sky-500/5 to-transparent",
    purple: "from-purple-500/15 via-purple-500/5 to-transparent",
    teal: "from-teal-500/15 via-teal-500/5 to-transparent",
  };

  const iconColorMap = {
    emerald: "text-emerald-400 border-emerald-500/20 bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.2)]",
    sky: "text-sky-400 border-sky-500/20 bg-sky-500/10 shadow-[0_0_15px_rgba(56,189,248,0.2)]",
    purple: "text-purple-400 border-purple-500/20 bg-purple-500/10 shadow-[0_0_15px_rgba(168,85,247,0.2)]",
    teal: "text-teal-400 border-teal-500/20 bg-teal-500/10 shadow-[0_0_15px_rgba(20,184,166,0.2)]",
  };

  const strokeMap = {
    red: "#f87171",
    amber: "#fbbf24",
    brand: "#34d399",
  };

  const stroke = strokeMap[tone];

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] }}
      className="glass-card glass-card-hover group p-5"
    >
      {/* Specular glass line */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
      {/* Subtle radial inner glow */}
      <div
        className={cn(
          "pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br blur-2xl transition-opacity duration-300 opacity-60 group-hover:opacity-100",
          glowMap[glowColor],
        )}
      />

      <div className="relative space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl border backdrop-blur-md transition-transform duration-300 group-hover:scale-110",
                iconColorMap[glowColor],
              )}
            >
              {icon}
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              {title}
            </span>
          </div>

          {showBadge ? (
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-mono text-slate-300 backdrop-blur-sm">
              {showBadge}
            </span>
          ) : (
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-mono font-medium",
                tone === "red"
                  ? "border-red-500/30 bg-red-500/10 text-red-300"
                  : tone === "amber"
                    ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
              )}
            >
              {Math.round(percent)}%
            </span>
          )}
        </div>

        <div>
          <p className="text-3xl font-extrabold tracking-tight text-white">{value}</p>
          <p className="mt-0.5 text-[11px] font-mono text-slate-400">{subtitle}</p>
        </div>

        {/* Progress Bar & Sparkline */}
        <div className="flex items-end justify-between gap-3 pt-1">
          <div className="h-2 w-full overflow-hidden rounded-full border border-white/5 bg-white/[0.05] p-0.5">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-500",
                tone === "red"
                  ? "bg-gradient-to-r from-red-500 to-rose-400 shadow-[0_0_10px_rgba(244,63,94,0.5)]"
                  : tone === "amber"
                    ? "bg-gradient-to-r from-amber-500 to-yellow-400 shadow-[0_0_10px_rgba(234,179,8,0.5)]"
                    : "bg-gradient-to-r from-brand-500 to-emerald-400 shadow-[0_0_10px_rgba(18,201,138,0.5)]",
              )}
              style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
            />
          </div>

          {spark && spark.length > 1 && (
            <div className="shrink-0" title="24h Trendline">
              <Sparkline values={spark} width={90} height={26} stroke={stroke} />
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/** Frosted Glass Navigation Pill */
function GlassQuickTab({
  icon,
  label,
  value,
  extra,
  href,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  extra: string;
  href: string;
  color: "emerald" | "cyan" | "indigo" | "amber";
}) {
  const colorMap = {
    emerald: "text-emerald-400 group-hover:bg-emerald-500/15",
    cyan: "text-sky-400 group-hover:bg-sky-500/15",
    indigo: "text-indigo-400 group-hover:bg-indigo-500/15",
    amber: "text-amber-400 group-hover:bg-amber-500/15",
  };

  return (
    <Link href={href}>
      <div className="glass-card glass-card-hover group p-4">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
        <div className="flex items-center gap-3">
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] transition-colors duration-200 backdrop-blur-md",
              colorMap[color],
            )}
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              {label}
            </p>
            <p className="truncate text-sm font-bold text-white">{value}</p>
            <p className="truncate text-[10px] text-slate-500">{extra}</p>
          </div>
        </div>
      </div>
    </Link>
  );
}
