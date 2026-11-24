"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Archive,
  CheckCircle2,
  Database,
  Download,
  FolderGit2,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/shell";
import { Badge, Button, Card, Empty, Field, Input, Modal, Select } from "@/components/ui";
import { usePanel, ago } from "@/lib/client";

type Backup = {
  id: string;
  kind: "files" | "db";
  target: string;
  file: string;
  size: number;
  verified: number;
  note: string | null;
  created_at: number;
};

export default function BackupsPage() {
  const { state, act } = usePanel();
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [managedDbs, setManagedDbs] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await act<{ backups: Backup[] }>("backup.list");
      setBackups(res.backups);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBackups([]);
    }
    // Managed DB names for the "database backup" target list; optional.
    try {
      const dbs = await act<{ databases: { name: string }[] }>("mysqldb.list");
      setManagedDbs(dbs.databases.map((d) => d.name));
    } catch {
      setManagedDbs([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(key: string, action: string, payload: Record<string, unknown> = {}) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await act(action, payload);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  function download(backup: Backup) {
    // Uses the file-manager download endpoint pattern: direct authed GET.
    window.open(`/api/backups/download?id=${encodeURIComponent(backup.id)}`, "_blank");
  }

  return (
    <>
      <PageHeader
        title="Backups"
        subtitle="File archives and database dumps stored under the panel data directory."
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => refresh()}>
              <RefreshCw size={14} /> Refresh
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> New backup
            </Button>
          </div>
        }
      />

      {error && (
        <p className="mb-4 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
          {notice}
        </p>
      )}

      {!backups ? (
        <div className="h-52 animate-pulse rounded-2xl border border-white/5 bg-ink-900/40" />
      ) : backups.length === 0 ? (
        <Empty
          title="No backups yet"
          hint="Create your first backup: an app directory archive or a MySQL database dump."
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> Create backup
            </Button>
          }
        />
      ) : (
        <div className="space-y-2.5">
          {backups.map((b) => (
            <Card key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-brand-400">
                  {b.kind === "db" ? <Database size={15} /> : <FolderGit2 size={15} />}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-white">{b.target}</h3>
                    <Badge tone={b.kind === "db" ? "info" : "neutral"}>{b.kind}</Badge>
                    {b.verified === 1 && (
                      <Badge tone="ok">
                        <CheckCircle2 size={10} className="mr-1 inline" /> verified
                      </Badge>
                    )}
                  </div>
                  <p className="truncate font-mono text-[11px] text-slate-500">{b.file}</p>
                  <p className="text-[11px] text-slate-600">
                    {formatSize(b.size)} · created {ago(b.created_at)}
                    {b.note ? ` · ${b.note}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="ghost"
                  title="Verify archive integrity"
                  loading={busy === `verify-${b.id}`}
                  onClick={() =>
                    void run(`verify-${b.id}`, "backup.verify", { id: b.id }).then(() =>
                      setNotice(`Verification finished for ${b.file}.`),
                    )
                  }
                >
                  <CheckCircle2 size={13} /> Verify
                </Button>
                <Button size="sm" variant="ghost" title="Download" onClick={() => download(b)}>
                  <Download size={13} />
                </Button>
                <Button
                  size="sm"
                  variant="subtle"
                  title="Restore from this backup"
                  loading={busy === `restore-${b.id}`}
                  onClick={() => {
                    const what = b.kind === "db" ? `database ${b.target}` : `app ${b.target}`;
                    if (
                      confirm(
                        `Restore ${what} from ${b.file}?\n\nFiles: the current directory is moved aside as ${b.target}.pre-restore first.\nDatabases: the dump's DROP/CREATE statements are applied.`,
                      )
                    ) {
                      void run(`restore-${b.id}`, "backup.restore", { id: b.id }).then(() =>
                        setNotice(`${what} restored from ${b.file}.`),
                      );
                    }
                  }}
                >
                  <RotateCcw size={13} /> Restore
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  loading={busy === `del-${b.id}`}
                  onClick={() => {
                    if (confirm(`Delete backup ${b.file}? The file is removed from disk.`)) {
                      void run(`del-${b.id}`, "backup.delete", { id: b.id });
                    }
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-6 text-[11px] leading-relaxed text-slate-500">
        Retention keeps the newest 10 backups per target; older ones are pruned by the background
        scheduler. Backups live on the same disk as the panel — for disaster recovery download them
        off the server.
      </p>

      <CreateBackupModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        apps={(state?.apps ?? []).map((a) => a.name)}
        managedDbs={managedDbs}
        onCreate={async (payload) => {
          await run("create", "backup.create", payload);
          setCreateOpen(false);
        }}
      />
    </>
  );
}

function formatSize(bytes: number): string {
  if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function CreateBackupModal({
  open,
  onClose,
  apps,
  managedDbs,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  apps: string[];
  managedDbs: string[];
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [kind, setKind] = useState<"files" | "db">("files");
  const [target, setTarget] = useState(apps[0] ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTarget(kind === "files" ? apps[0] ?? "" : managedDbs[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate({ kind, target, note: note || undefined });
      setNote("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const targets = kind === "files" ? apps : managedDbs;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New backup"
      description="Archives are stored in the panel data directory under backups/."
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="What to back up">
            <Select value={kind} onChange={(e) => setKind(e.target.value as "files" | "db")}>
              <option value="files">App files (tar.gz)</option>
              <option value="db">MySQL database (dump)</option>
            </Select>
          </Field>
          <Field label="Target">
            {targets.length === 0 ? (
              <Input value="" disabled placeholder={kind === "files" ? "No apps yet" : "No managed databases yet"} />
            ) : (
              <Select value={target} onChange={(e) => setTarget(e.target.value)}>
                {targets.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="before migration v3" />
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
          <Button type="submit" size="sm" loading={busy} disabled={!target}>
            <Archive size={13} /> Create backup
          </Button>
        </div>
      </form>
    </Modal>
  );
}
