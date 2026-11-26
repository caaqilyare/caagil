"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpCircle, Check, Loader2, RefreshCw, RotateCcw, X } from "lucide-react";
import { Button, cn } from "./ui";

type Info = {
  current: string;
  latest: string | null;
  available: boolean;
  running: boolean;
  state: "idle" | "running" | "done" | "error" | "unavailable";
  log: string;
  error?: string;
  canRollback?: boolean;
  previousCommit?: string | null;
};

const short = (sha: string | null | undefined) => (sha && sha !== "unknown" ? sha.slice(0, 7) : "—");

const UPDATE_STEPS = ["Fetching code from GitHub", "Building the new panel image", "Restarting the panel"];
const ROLLBACK_STEPS = ["Switching to previous commit", "Restoring previous image", "Restarting the panel"];

export function UpdateCard() {
  const [info, setInfo] = useState<Info | null>(null);
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const baseline = useRef<string | null>(null);
  const updatingRef = useRef(false);

  const load = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/update", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as Info;
      setInfo(data);
      // Joining an update that was already started (another tab, or the
      // panel was restarted while building): show the overlay and remember
      // which commit we started from, so the reload fires when it lands.
      if (data.running && !updatingRef.current) {
        baseline.current = baseline.current ?? data.current;
        updatingRef.current = true;
        setUpdating(true);
        setOpen(true);
      }
      if (updatingRef.current) {
        if (data.state === "error") {
          setError(data.error || "The update failed.");
          setUpdating(false);
          updatingRef.current = false;
        } else if (data.state === "done" && (!baseline.current || data.current !== baseline.current)) {
          setUpdating(false);
          updatingRef.current = false;
          setDone(true);
          setTimeout(() => window.location.reload(), 1400);
        }
      }
    } catch {
      // The panel container is being recreated — keep the overlay spinning.
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const ms = updating ? 2500 : 5 * 60 * 1000;
    const id = setInterval(() => void load(), ms);
    return () => clearInterval(id);
  }, [load, updating]);

  async function start() {
    setError(null);
    setDone(false);
    setOpen(true);
    setStarting(true);
    baseline.current = info?.current ?? null;
    try {
      const res = await fetch("/api/update", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Could not start the update.");
        return;
      }
      setUpdating(true);
      updatingRef.current = true;
      // Give the updater a moment to write its state file before polling.
      setTimeout(() => void load(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the update.");
    } finally {
      setStarting(false);
    }
  }

  async function rollback() {
    if (!confirm("Are you sure you want to rollback to the previous version?")) return;
    setError(null);
    setDone(false);
    setOpen(true);
    setStarting(true);
    baseline.current = info?.current ?? null;
    try {
      const res = await fetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "rollback" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "Could not start the rollback.");
        return;
      }
      setUpdating(true);
      updatingRef.current = true;
      setTimeout(() => void load(), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the rollback.");
    } finally {
      setStarting(false);
    }
  }

  const log = info?.log ?? "";
  const isRollback = log.includes("rollback started");
  const step = done || info?.state === "done"
    ? 3
    : log.includes("restarting the panel") || log.includes("waiting for the panel to answer")
      ? 2
      : log.includes("building the new panel image") || log.includes("docker compose build")
        ? 1
        : log.includes("fetching code") || log.includes("git pull") || log.includes("update started") || log.includes("rollback started")
          ? 0
          : 0;

  const currentSteps = isRollback ? ROLLBACK_STEPS : UPDATE_STEPS;
  const busy = starting || updating;
  const available = Boolean(info?.available) && !busy && !done;
  const offline = info?.state === "unavailable";
  const unknown = info?.current === "unknown";

  return (
    <>
      {info && (
        <div
          className={cn(
            "rounded-xl border p-3",
            available
              ? "border-amber-400/30 bg-amber-400/10"
              : offline
                ? "border-red-500/25 bg-red-500/10"
                : "border-white/10 bg-ink-950/50",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                "flex items-center gap-1.5 text-xs font-medium",
                available ? "text-amber-200" : offline ? "text-red-300" : "text-slate-200",
              )}
            >
              {busy ? (
                <Loader2 size={13} className="animate-spin text-brand-400" />
              ) : available ? (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-70" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                </span>
              ) : (
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    done ? "bg-emerald-400" : offline ? "bg-red-400" : "bg-emerald-400",
                  )}
                />
              )}
              {busy
                ? isRollback
                  ? "Rolling back panel…"
                  : "Updating panel…"
                : done
                  ? "Installed successfully"
                  : available
                    ? "Update available"
                    : offline
                      ? "Update check unavailable"
                      : unknown
                        ? "Version unknown"
                        : "Panel is up to date"}
            </span>
            <button
              onClick={() => void load()}
              className="text-slate-400 transition hover:text-white"
              aria-label="Check for updates"
            >
              <RefreshCw size={12} className={cn(checking && "animate-spin")} />
            </button>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-slate-400">
            {busy
              ? "The panel restarts automatically when finished."
              : done
                ? "Reloading with the restored version…"
                : available
                  ? unknown
                    ? `Build metadata missing · update to install main @ ${short(info.latest)}`
                    : `main @ ${short(info.latest)} · you run ${short(info.current)}`
                  : offline
                    ? info.error || "The updater sidecar is not reachable."
                    : unknown
                      ? "Re-run scripts/install.sh once to enable in-panel updates."
                      : `main @ ${short(info.latest)} · you run ${short(info.current)}`}
          </p>
          {available && (
            <Button size="sm" className="mt-2 w-full" onClick={start}>
              <ArrowUpCircle size={13} /> Update now
            </Button>
          )}
          {info.canRollback && !busy && (
            <Button
              size="sm"
              variant="danger"
              className="mt-2 w-full"
              onClick={rollback}
            >
              <RotateCcw size={13} /> Rollback to {short(info.previousCommit)}
            </Button>
          )}
          {busy && (
            <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={() => setOpen(true)}>
              Show progress
            </Button>
          )}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm">
          <div className="animate-fade-up relative w-full max-w-md rounded-2xl border border-white/10 bg-ink-900 p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
                  {done ? (
                    <Check size={16} className="text-emerald-400" />
                  ) : (
                    <Loader2 size={16} className="animate-spin text-brand-400" />
                  )}
                  {done
                    ? "Completed successfully"
                    : isRollback
                      ? "Rolling back Caaqil"
                      : "Updating Caaqil"}
                </h2>
                <p className="mt-1 text-[11px] text-slate-400">
                  {done
                    ? "Reloading panel…"
                    : isRollback
                      ? "Restoring previous release image and git commit."
                      : "Fast cached build · Auto-rollback on error."}
                </p>
              </div>
              {!busy && (
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-lg p-1 text-slate-400 transition hover:bg-white/5 hover:text-white"
                  aria-label="Close"
                >
                  <X size={15} />
                </button>
              )}
            </div>

            <div className="mb-4 flex justify-center">
              <span
                className={cn(
                  "flex h-14 w-14 items-center justify-center rounded-full border-2",
                  done
                    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-400"
                    : isRollback
                      ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
                      : "border-brand-500/30 bg-brand-500/10 text-brand-400",
                )}
              >
                {done ? (
                  <Check size={24} />
                ) : (
                  <Loader2 size={24} className="animate-spin" />
                )}
              </span>
            </div>

            <ol className="space-y-2">
              {currentSteps.map((label, i) => {
                const finished = done || i < step;
                const active = !done && i === step && busy;
                return (
                  <li key={label} className="flex items-center gap-2.5 text-xs">
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                        finished
                          ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-400"
                          : active
                            ? "border-brand-500/50 bg-brand-500/10 text-brand-400"
                            : "border-white/10 text-slate-600",
                      )}
                    >
                      {finished ? (
                        <Check size={11} />
                      ) : active ? (
                        <Loader2 size={11} className="animate-spin" />
                      ) : (
                        <span className="text-[9px]">{i + 1}</span>
                      )}
                    </span>
                    <span className={finished || active ? "text-slate-200" : "text-slate-500"}>
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>

            {error && (
              <p className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
                {error}
              </p>
            )}

            {log && (
              <pre className="mt-3 max-h-32 overflow-auto rounded-lg border border-white/5 bg-ink-950/70 p-2.5 text-[10px] leading-relaxed text-slate-400">
                {log.split("\n").slice(-8).join("\n")}
              </pre>
            )}

            {!busy && !done && (
              <div className="mt-4 flex flex-col gap-2">
                <Button size="sm" className="w-full" onClick={start} loading={starting}>
                  <ArrowUpCircle size={13} /> Try update again
                </Button>
                {info?.canRollback && (
                  <Button
                    size="sm"
                    variant="danger"
                    className="w-full"
                    onClick={rollback}
                    loading={starting}
                  >
                    <RotateCcw size={13} /> Rollback to {short(info.previousCommit)}
                  </Button>
                )}
              </div>
            )}
            {done && (
              <p className="mt-4 text-center text-[11px] text-emerald-300">
                Reloading automatically…
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
