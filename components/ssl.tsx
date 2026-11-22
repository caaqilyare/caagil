"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { Badge, Button, Modal } from "@/components/ui";
import { JobProgress, useJob } from "@/components/deploy-progress";
import { usePanel } from "@/lib/client";

export type DomainSsl = {
  host: string;
  scope: "panel" | "app";
  appName?: string | null;
  ok: boolean;
  issuer?: string;
  expiresAt?: number;
  selfSigned?: boolean;
  reason?: string;
};

/** Live SSL status for every hostname, probed on demand. */
export function useSslStatus(enabled: boolean) {
  const { act } = usePanel();
  const [map, setMap] = useState<Record<string, DomainSsl>>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await act<{ domains: DomainSsl[] }>("ssl.status", {});
      const next: Record<string, DomainSsl> = {};
      for (const entry of res?.domains ?? []) next[entry.host] = entry;
      setMap(next);
    } catch {
      /* keep the last known state */
    } finally {
      setLoading(false);
    }
  }, [act, enabled]);

  useEffect(() => {
    if (enabled) void refresh();
  }, [enabled, refresh]);

  return { map, loading, refresh };
}

export function SslBadge({ status }: { status?: DomainSsl }) {
  if (!status) {
    return (
      <Badge tone="neutral">
        <ShieldCheck size={11} /> checking…
      </Badge>
    );
  }
  if (status.ok) {
    const days = status.expiresAt
      ? Math.max(0, Math.round((status.expiresAt - Date.now()) / 86_400_000))
      : null;
    return (
      <Badge tone="ok">
        <ShieldCheck size={11} /> {status.issuer || "SSL"}
        {days !== null ? ` · ${days}d left` : ""}
      </Badge>
    );
  }
  return (
    <Badge tone="bad">
      <ShieldAlert size={11} /> {status.selfSigned ? "no SSL yet" : "SSL error"}
    </Badge>
  );
}

/**
 * Runs the "Add SSL" flow (DNS check → refresh route → wait for Let's Encrypt
 * → verify) with a live step-by-step progress screen.
 */
export function SslFixModal({
  domain,
  onClose,
  onDone,
}: {
  domain: string;
  onClose: () => void;
  onDone?: () => void;
}) {
  const { act } = usePanel();
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const job = useJob(jobId, () => onDone?.());
  const jobFailed = job?.status === "error";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await act<{ job?: string }>("ssl.add", { domain });
        if (!cancelled && res?.job) setJobId(res.job);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [domain]);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Add SSL · ${domain}`}
      description="Requests a Let's Encrypt certificate and waits until HTTPS actually works."
    >
      {error ? (
        <div className="space-y-3">
          <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <JobProgress
          job={job}
          onBack={jobFailed ? onClose : undefined}
          backLabel="Close"
        >
          <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            {domain} is served over HTTPS with a valid certificate.
          </p>
          <div className="flex justify-end">
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </JobProgress>
      )}
    </Modal>
  );
}
