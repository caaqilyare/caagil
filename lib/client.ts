"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppDbRow, AppRow, DatabaseRow, TargetRow } from "@/lib/ops";
import type { SystemStats } from "@/lib/stats";
import type { DbEngine, RuntimePreset } from "@/lib/presets";

export type DomainRow = {
  id: string;
  host: string;
  app_id: string | null;
  app_name: string | null;
  cert: string;
  created_at: number;
};

export type ActivityRow = {
  id: number;
  ts: number;
  actor: string;
  action: string;
  detail: string;
  ok: number;
};

export type PanelState = {
  version?: string;
  user: { id: string; email: string; role: string };
  apps: (AppRow & { wp_db?: AppDbRow | null })[];
  databases: DatabaseRow[];
  domains: DomainRow[];
  targets: TargetRow[];
  activity: ActivityRow[];
  stats: SystemStats;
  publicIp: string | null;
  panel: {
    name: string;
    url: string;
    domain: string | null;
    allowIp: boolean;
    ip: string | null;
  };
  ai: { provider: string; model: string; label: string; hasKey: boolean };
  providers: { id: string; label: string; models: string[] }[];
  presets: RuntimePreset[];
  engines: DbEngine[];
};

export function usePanel() {
  const [state, setState] = useState<PanelState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (!res.ok) throw new Error("Could not load panel state.");
      setState((await res.json()) as PanelState);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const act = useCallback(
    async <T = unknown>(action: string, payload: Record<string, unknown> = {}): Promise<T> => {
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, payload }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Action failed");
      await reload();
      return data.result as T;
    },
    [reload],
  );

  return { state, loading, error, reload, act };
}

export function ago(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
