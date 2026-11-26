"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Database,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Badge, Button, cn } from "./ui";
import type { CleanupResult, StorageInfo } from "@/lib/storage";

function fmt(bytes: number): string {
  const n = Math.max(0, Number(bytes) || 0);
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[i]}`;
}

async function call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch("/api/actions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, payload }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data.result as T;
}

const TONE: Record<string, string> = {
  images: "bg-sky-400",
  containers: "bg-violet-400",
  buildCache: "bg-amber-400",
  volumes: "bg-emerald-400",
  appData: "bg-brand-400",
  backups: "bg-rose-400",
};

export function StorageCard() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"safe" | "deep" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CleanupResult | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      setInfo(await call<StorageInfo>("storage.info"));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const clean = async (deep: boolean) => {
    if (deep && !confirm("Deep clean removes the whole Docker build cache. The next panel update will rebuild from scratch (slower). Continue?")) {
      return;
    }
    setBusy(deep ? "deep" : "safe");
    setError(null);
    setResult(null);
    try {
      const res = await call<CleanupResult>("storage.cleanup", { deep });
      setResult(res);
      setInfo(res.info);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const disk = info?.disk;
  const dockerBytes = info?.dockerBytes ?? 0;
  const categories = info?.categories ?? [];

  return (
    <div className="glass-card space-y-5 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-brand-400/20 bg-brand-400/10 text-brand-400">
            <HardDrive size={14} />
          </span>
          <span>Disk &amp; Storage</span>
        </div>
        <div className="flex items-center gap-2">
          {disk && (
            <Badge tone={disk.percent >= 90 ? "bad" : disk.percent >= 75 ? "warn" : "ok"}>
              {disk.percent}% used
            </Badge>
          )}
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading || busy !== null}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh
          </Button>
        </div>
      </div>

      {error && (
        <p className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-xs text-rose-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {info && !info.dockerOk && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> Docker is not reachable from the
          panel, so image and build-cache figures are unavailable. The disk total below is still
          accurate.
        </p>
      )}

      {loading && !info && (
        <div className="flex items-center gap-2 py-6 text-xs text-slate-400">
          <Loader2 size={14} className="animate-spin" /> Reading Docker disk usage…
        </div>
      )}

      {info && disk && (
        <>
          {/* Disk bar */}
          <div className="space-y-2">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-2xl font-semibold tracking-tight text-white">
                  {fmt(disk.usedBytes)} <span className="text-sm font-normal text-slate-400">of {fmt(disk.totalBytes)}</span>
                </p>
                <p className="text-xs text-slate-400">{fmt(disk.freeBytes)} free on the panel disk</p>
              </div>
              <p className="text-right text-xs text-slate-400">
                Docker <span className="font-mono text-slate-200">{fmt(dockerBytes)}</span>
                <br />
                {info.swap ? (
                  <>Swap <span className="font-mono text-slate-200">{fmt(info.swap.usedBytes)}</span> / {fmt(info.swap.totalBytes)}</>
                ) : (
                  <>No swap file</>
                )}
              </p>
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-white/5">
              {categories.map((c) => {
                const pct = disk.totalBytes ? (c.bytes / disk.totalBytes) * 100 : 0;
                if (pct <= 0) return null;
                return (
                  <div
                    key={c.key}
                    className={cn("h-full", TONE[c.key] ?? "bg-slate-400")}
                    style={{ width: `${Math.max(pct, 0.6)}%` }}
                    title={`${c.label}: ${fmt(c.bytes)}`}
                  />
                );
              })}
              <div className="h-full flex-1 bg-white/5" title="Free" />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400">
              {categories
                .filter((c) => c.bytes > 0)
                .map((c) => (
                  <span key={c.key} className="inline-flex items-center gap-1.5">
                    <span className={cn("h-2 w-2 rounded-sm", TONE[c.key] ?? "bg-slate-400")} />
                    {c.label} <span className="font-mono text-slate-300">{fmt(c.bytes)}</span>
                  </span>
                ))}
            </div>
          </div>

          {/* Reclaimable */}
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-white">
                  {info.reclaimableBytes > 0 ? (
                    <>Up to <span className="text-brand-400">{fmt(info.reclaimableBytes)}</span> can be freed safely</>
                  ) : (
                    <>Nothing reclaimable right now</>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-slate-400">
                  Stopped containers, dangling images and unused build cache. Volumes, running images,
                  the <span className="font-mono">:previous</span> rollback tag and your data are never touched.
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void clean(false)} loading={busy === "safe"} disabled={busy !== null}>
                  <Trash2 size={13} /> Safe cleanup
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void clean(true)}
                  loading={busy === "deep"}
                  disabled={busy !== null}
                >
                  Deep clean
                </Button>
              </div>
            </div>

            {result && (
              <div className="mt-3 rounded-xl border border-brand-500/20 bg-brand-500/5 p-3 text-xs text-brand-200">
                <p className="flex items-center gap-1.5 font-medium">
                  <Check size={13} /> Freed {fmt(result.reclaimedBytes)}
                </p>
                {result.details.length > 0 && (
                  <ul className="mt-1 list-inside list-disc text-brand-200/80">
                    {result.details.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Breakdown */}
          <div className="grid gap-2 sm:grid-cols-2">
            {categories.map((c) => (
              <div key={c.key} className="flex items-start justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-200">{c.label}</p>
                  <p className="truncate text-[11px] text-slate-500" title={c.note}>{c.note}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-xs text-slate-200">{fmt(c.bytes)}</p>
                  {c.reclaimableBytes > 0 && (
                    <p className="text-[10px] text-brand-400">{fmt(c.reclaimableBytes)} free</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Images / volumes */}
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className="flex w-full items-center justify-between rounded-xl border border-white/5 px-3 py-2 text-xs text-slate-400 hover:bg-white/5"
          >
            <span className="inline-flex items-center gap-2">
              <ImageIcon size={13} /> Images and volumes ({info.images.length} images, {info.volumes.length} volumes)
            </span>
            <ChevronDown size={14} className={cn("transition", showDetail && "rotate-180")} />
          </button>

          {showDetail && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Images</p>
                {info.images.length === 0 && <p className="text-xs text-slate-500">None</p>}
                {info.images.map((img, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-mono text-slate-300" title={img.tags.join(", ") || "<none>"}>
                      {img.tags[0] ?? "<none>"}
                      {img.tags.length > 1 && <span className="text-slate-500"> +{img.tags.length - 1}</span>}
                    </span>
                    <span className="shrink-0 text-slate-400">
                      {img.inUse && <span className="mr-1 text-brand-400">in use</span>}
                      {fmt(img.bytes)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="space-y-1.5">
                <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <Database size={11} /> Volumes
                </p>
                {info.volumes.length === 0 && <p className="text-xs text-slate-500">None</p>}
                {info.volumes.map((v) => (
                  <div key={v.name} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-mono text-slate-300" title={v.name}>{v.name}</span>
                    <span className="shrink-0 text-slate-400">
                      {!v.inUse && <span className="mr-1 text-amber-300">unused</span>}
                      {fmt(v.bytes)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-slate-500">
            Build cache is capped at ~1 GB so panel updates stay fast. The <span className="font-mono">/opt/caaqil/scripts/reclaim-disk.sh</span>{" "}
            script also shrinks the swap file, vacuums the journal and clears APT caches for a 15 GB server.
          </p>
        </>
      )}
    </div>
  );
}
