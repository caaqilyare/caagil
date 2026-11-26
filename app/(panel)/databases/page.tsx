"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Braces,
  Check,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Square,
  Terminal,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Wifi,
} from "lucide-react";
import { PageHeader } from "@/components/shell";
import {
  Badge,
  Button,
  Card,
  Code,
  Empty,
  Field,
  Input,
  Modal,
  Select,
  StatusDot,
  cn,
} from "@/components/ui";
import { usePanel } from "@/lib/client";
import { GlassPanel, GlowItem, GlowList } from "@/components/glow";
import type { DatabaseRow, TargetRow } from "@/lib/ops";
import type { DbEngine } from "@/lib/presets";

type PmaStatus = {
  installed: boolean;
  running: boolean;
  url: string | null;
  host: string | null;
  error?: string;
};

type MysqlInfoT = {
  version: string | null;
  uptimeSeconds: number | null;
  threadsConnected: number | null;
  maxConnections: number | null;
  sizeMb: number;
  databases: number;
  reachable: boolean;
  error?: string;
};

type ManagedDb = { name: string; sizeMb: number; tables: number; app: string | null };
type DbUserT = { name: string; host: string; databases: string[] };

type MongoStudioT = {
  database: string;
  installed: boolean;
  running: boolean;
  url: string | null;
  username: string | null;
  password: string | null;
  error?: string;
};

export default function DatabasesPage() {
  const { state, loading, act } = usePanel();
  const [createOpen, setCreateOpen] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const [consoleFor, setConsoleFor] = useState<TargetRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // phpMyAdmin + managed MySQL state
  const [pma, setPma] = useState<PmaStatus | null>(null);
  const [mysql, setMysql] = useState<MysqlInfoT | null>(null);
  const [managedDbs, setManagedDbs] = useState<ManagedDb[] | null>(null);
  const [dbUsers, setDbUsers] = useState<DbUserT[] | null>(null);
  const [newDbOpen, setNewDbOpen] = useState(false);
  const [newUserOpen, setNewUserOpen] = useState(false);
  const [importFor, setImportFor] = useState<string | null>(null);

  // MongoDB Studio (mongo-express), one per managed MongoDB database.
  const [studios, setStudios] = useState<Record<string, MongoStudioT>>({});
  const mongoDatabases = (state?.databases ?? []).filter((db) => db.engine === "mongo");
  const mongoKey = mongoDatabases.map((db) => db.name).join(",");

  const refreshMysql = useCallback(async () => {
    try {
      const [info, dbs, users] = await Promise.all([
        act<MysqlInfoT>("mysqldb.info"),
        act<{ databases: ManagedDb[] }>("mysqldb.list"),
        act<{ users: DbUserT[] }>("dbuser.list"),
      ]);
      setMysql(info);
      setManagedDbs(dbs.databases);
      setDbUsers(users.users);
    } catch {
      // Server without managed MySQL — section simply stays empty.
      setMysql(null);
      setManagedDbs([]);
      setDbUsers([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void refreshMysql();
  }, [refreshMysql]);

  async function run(key: string, action: string, payload: Record<string, unknown> = {}) {
    setBusy(key);
    setError(null);
    try {
      await act(action, payload);
      await refreshMysql();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function runPma(action: string) {
    setBusy(`pma-${action}`);
    setError(null);
    try {
      const status = await act<PmaStatus>(action);
      setPma(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function runStudio(name: string, action: "start" | "stop") {
    setBusy(`mongo-${action}-${name}`);
    setError(null);
    try {
      const status = await act<MongoStudioT>(`mongo.${action}`, { name });
      setStudios((cur) => ({ ...cur, [name]: status }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function downloadExport(name: string) {
    setBusy(`export-${name}`);
    setError(null);
    try {
      const res = await act<{ filename: string; sql: string }>("mysqldb.export", { name });
      const blob = new Blob([res.sql], { type: "application/sql" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function resetUserPassword(name: string) {
    setBusy(`pw-${name}`);
    setError(null);
    try {
      const res = await act<{ password: string }>("dbuser.password", { name });
      alert(`New password for ${name}:\n${res.password}\n\nStore it somewhere safe — it is shown once.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    // Initial phpMyAdmin status fetch (no side effects on failure).
    void (async () => {
      try {
        setPma(await act<PmaStatus>("pma.status"));
      } catch {
        setPma(null);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mongoKey) {
      setStudios({});
      return;
    }
    let alive = true;
    void (async () => {
      const names = mongoKey.split(",");
      const pairs = await Promise.all(
        names.map(async (name) => {
          try {
            return [name, await act<MongoStudioT>("mongo.status", { name })] as const;
          } catch {
            return [name, null] as const;
          }
        }),
      );
      if (!alive) return;
      const next: Record<string, MongoStudioT> = {};
      for (const [name, status] of pairs) if (status) next[name] = status;
      setStudios(next);
    })();
    return () => {
      alive = false;
    };
    // The key changes only when the set of MongoDB databases changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mongoKey]);

  return (
    <>
      <PageHeader
        title="Databases"
        subtitle="MySQL, MariaDB, PostgreSQL, MongoDB and Redis — with optional public access."
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setTargetOpen(true)}>
              <Server size={14} /> External MySQL
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> New database
            </Button>
          </div>
        }
      />

      {error && (
        <p className="mb-4 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {loading || !state ? (
        <div className="h-52 animate-pulse rounded-2xl border border-white/5 bg-ink-900/40" />
      ) : state.databases.length === 0 ? (
        <Empty
          title="No databases yet"
          hint="Create a MySQL instance and connect it to your PHP or Node app in one click."
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus size={14} /> Create database
            </Button>
          }
        />
      ) : (
        <GlowList className="grid gap-3 lg:grid-cols-2">
          {state.databases.map((db) => (
            <GlowItem key={db.id}>
              <DbCard
                db={db}
                publicIp={state.publicIp}
                busy={busy}
                onAction={run}
              />
            </GlowItem>
          ))}
        </GlowList>
      )}

      <div className="mt-8">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Wifi size={14} className="text-brand-400" /> External MySQL servers
          </h2>
          <Button size="sm" variant="ghost" onClick={() => setTargetOpen(true)}>
            <Plus size={13} /> Attach server
          </Button>
        </div>

        {state && state.targets.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-slate-500">
            Attach a MySQL server running anywhere — the panel connects over TLS and lets you query it.
          </p>
        ) : (
          <div className="space-y-2">
            {state?.targets.map((t) => (
              <Card key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-medium text-white">{t.name}</p>
                  <p className="text-[11px] text-slate-500">
                    {t.username}@{t.host}:{t.port} {t.use_tls ? "· TLS" : ""}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === `test-${t.id}`}
                    onClick={() => run(`test-${t.id}`, "target.test", { id: t.id })}
                  >
                    <Wifi size={13} /> Test
                  </Button>
                  <Button size="sm" variant="subtle" onClick={() => setConsoleFor(t)}>
                    <Terminal size={13} /> Console
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy === `del-${t.id}`}
                    onClick={() => run(`del-${t.id}`, "target.remove", { id: t.id })}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* phpMyAdmin */}
      <div className="mt-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <Server size={14} className="text-brand-400" /> phpMyAdmin
        </h2>
        <PmaCard
          status={pma ?? null}
          busy={busy}
          onAction={runPma}
          onLaunch={() => {
            window.location.href = "/api/pma/launch";
          }}
        />
      </div>

      {/* MongoDB Studio */}
      {mongoDatabases.length > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Braces size={14} className="text-sky-400" /> MongoDB Studio
            </h2>
            <span className="text-[11px] text-slate-500">
              One mongo-express instance per database · basic auth
            </span>
          </div>
          <GlowList className="grid gap-3 lg:grid-cols-2">
            {mongoDatabases.map((db) => (
              <GlowItem key={db.name}>
                <MongoStudioCard
                  db={db}
                  studio={studios[db.name] ?? null}
                  busy={busy}
                  onStart={() => void runStudio(db.name, "start")}
                  onStop={() => void runStudio(db.name, "stop")}
                />
              </GlowItem>
            ))}
          </GlowList>
        </div>
      )}

      {/* Managed MySQL administration */}
      <div className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Database size={14} className="text-brand-400" /> MySQL administration
          </h2>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setNewUserOpen(true)}>
              <UserPlus size={13} /> New user
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNewDbOpen(true)}>
              <Plus size={13} /> New database
            </Button>
            <Button size="sm" variant="ghost" onClick={() => refreshMysql()}>
              <RefreshCw size={13} /> Refresh
            </Button>
          </div>
        </div>

        {mysql && mysql.reachable && (
          <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <span>
              MySQL <span className="text-slate-300">{mysql.version}</span>
            </span>
            <span>
              up <span className="text-slate-300">{uptime(mysql.uptimeSeconds)}</span>
            </span>
            <span>
              {mysql.databases} databases · <span className="text-slate-300">{mysql.sizeMb} MB</span>
            </span>
            <span>
              connections <span className="text-slate-300">
                {mysql.threadsConnected ?? "?"}/{mysql.maxConnections ?? "?"}
              </span>
            </span>
          </p>
        )}
        {mysql && !mysql.reachable && (
          <p className="mb-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            Managed MySQL server is not reachable. {mysql.error}
          </p>
        )}

        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-brand-400">
                <Database size={14} />
              </span>
              <h3 className="text-sm font-semibold text-white">Databases</h3>
            </div>
            {!managedDbs || managedDbs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 px-3 py-5 text-center text-xs text-slate-500">
                No managed databases on the panel MySQL server yet.
              </p>
            ) : (
              <div className="space-y-2">
                {managedDbs.map((db) => (
                  <div
                    key={db.name}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/5 px-3 py-2"
                  >
                    <div>
                      <p className="text-sm font-medium text-white">
                        {db.name} {db.app && <Badge tone="info">{db.app}</Badge>}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {db.sizeMb} MB · {db.tables} tables
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Download SQL dump"
                        loading={busy === `export-${db.name}`}
                        onClick={() => void downloadExport(db.name)}
                      >
                        <Download size={13} />
                      </Button>
                      <Button size="sm" variant="ghost" title="Import SQL" onClick={() => setImportFor(db.name)}>
                        <Upload size={13} />
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        title="Delete database"
                        loading={busy === `dropdb-${db.name}`}
                        onClick={() => {
                          if (confirm(`Drop database ${db.name}? This removes all data.`)) {
                            void run(`dropdb-${db.name}`, "mysqldb.drop", { name: db.name });
                          }
                        }}
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-brand-400">
                <Users size={14} />
              </span>
              <h3 className="text-sm font-semibold text-white">Users & privileges</h3>
            </div>
            {!dbUsers || dbUsers.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 px-3 py-5 text-center text-xs text-slate-500">
                No panel-managed MySQL users yet.
              </p>
            ) : (
              <div className="space-y-2">
                {dbUsers.map((u) => (
                  <div key={`${u.name}@${u.host}`} className="rounded-xl border border-white/5 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-white">
                          {u.name}@{u.host}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          <KeyRound size={10} className="mr-1 inline align-text-bottom" />
                          {u.databases.length > 0 ? u.databases.join(", ") : "no grants yet"}
                        </p>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Reset password (shows the new password once)"
                          loading={busy === `pw-${u.name}`}
                          onClick={() => void resetUserPassword(u.name)}
                        >
                          <KeyRound size={13} />
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          title="Delete user"
                          loading={busy === `dropuser-${u.name}`}
                          onClick={() => {
                            if (confirm(`Delete MySQL user ${u.name}?`)) {
                              void run(`dropuser-${u.name}`, "dbuser.drop", { name: u.name });
                            }
                          }}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <CreateDatabaseModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        engines={state?.engines ?? []}
        publicIp={state?.publicIp ?? null}
        onCreate={async (payload) => {
          await act("db.create", payload);
          setCreateOpen(false);
        }}
      />

      <AddTargetModal
        open={targetOpen}
        onClose={() => setTargetOpen(false)}
        onCreate={async (payload) => {
          await act("target.add", payload);
          setTargetOpen(false);
        }}
      />

      <NewDbModal
        open={newDbOpen}
        onClose={() => setNewDbOpen(false)}
        onCreate={async (name) => {
          await run("newdb", "mysqldb.create", { name });
          setNewDbOpen(false);
        }}
      />

      <NewUserModal
        open={newUserOpen}
        onClose={() => setNewUserOpen(false)}
        databases={managedDbs?.map((d) => d.name) ?? []}
        onCreate={async (name, databases) => {
          const res = await act<{ password: string }>("dbuser.create", { name, databases });
          setNewUserOpen(false);
          alert(`User ${name} created.\nPassword: ${res.password}\nStore it somewhere safe — it is shown once.`);
        }}
      />

      <ImportModal
        dbName={importFor}
        onClose={() => setImportFor(null)}
        onImport={async (name, sql) => {
          await act("mysqldb.import", { name, sql });
          setImportFor(null);
        }}
      />

      <SqlConsole target={consoleFor} onClose={() => setConsoleFor(null)} run={act} />
    </>
  );
}

function uptime(seconds: number | null): string {
  if (!seconds) return "?";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function PmaCard({
  status,
  busy,
  onAction,
  onLaunch,
}: {
  status: PmaStatus | null;
  busy: string | null;
  onAction: (action: string) => Promise<void>;
  onLaunch: () => void;
}) {
  if (!status) {
    return (
      <GlassPanel className="flex flex-wrap items-center justify-between gap-3 p-4" interactive={false}>
        <div>
          <p className="text-sm font-medium text-white">phpMyAdmin</p>
          <p className="text-[11px] text-slate-500">
            Status unavailable — the Docker engine may be offline.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => void onAction("pma.status")}>
          <RefreshCw size={13} /> Retry
        </Button>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="space-y-3 p-5" interactive={false}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-brand-400">
            <Server size={16} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <StatusDot ok={status.running} />
              <h3 className="text-sm font-semibold text-white">phpMyAdmin</h3>
              <Badge tone={status.running ? "ok" : status.installed ? "warn" : "neutral"}>
                {status.running ? "running" : status.installed ? "stopped" : "not installed"}
              </Badge>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {status.url ? (
                <>
                  <Code>{status.url}</Code>
                </>
              ) : (
                "Set a panel domain or IP access in Settings to enable phpMyAdmin."
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {status.running ? (
            <>
              <Button size="sm" onClick={onLaunch}>
                <ExternalLink size={13} /> Open phpMyAdmin
              </Button>
              <Button
                size="sm"
                variant="ghost"
                loading={busy === "pma-pma.stop"}
                onClick={() => void onAction("pma.stop")}
              >
                <Square size={13} /> Stop
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              loading={busy === "pma-pma.start"}
              onClick={() => void onAction("pma.start")}
            >
              <Play size={13} /> {status.installed ? "Start" : "Install & start"}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            loading={busy === "pma-pma.status"}
            onClick={() => void onAction("pma.status")}
          >
            <RefreshCw size={13} />
          </Button>
        </div>
      </div>
      {status.error && (
        <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {status.error}
        </p>
      )}
      <p className="text-[11px] leading-relaxed text-slate-500">
        Sessions open through a one-time, 60-second signon token — MySQL passwords never appear in
        URLs. The phpMyAdmin MySQL user is limited to the panel&apos;s managed app databases; root
        credentials are never shared with it.
      </p>
    </GlassPanel>
  );
}

function MongoStudioCard({
  db,
  studio,
  busy,
  onStart,
  onStop,
}: {
  db: DatabaseRow;
  studio: MongoStudioT | null;
  busy: string | null;
  onStart: () => void;
  onStop: () => void;
}) {
  const [reveal, setReveal] = useState(false);
  const [copied, setCopied] = useState<"user" | "pass" | null>(null);
  const running = Boolean(studio?.running);
  const installed = Boolean(studio?.installed);

  async function copy(label: "user" | "pass", value: string | null) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1400);
    } catch {
      /* clipboard permission denied — the value is still visible */
    }
  }

  return (
    <GlassPanel
      accent="cyan"
      className="overflow-hidden p-0 transition-all hover:shadow-[0_12px_32px_-12px_rgba(0,73,232,0.28)]"
      interactive={false}
    >
      {/* Amazing AdminUX Gradient Hero Header */}
      <div className="bg-theme-r-gradient relative px-5 py-4 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15 text-white ring-1 ring-white/25 backdrop-blur-md">
              <Braces size={18} />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold tracking-tight text-white">{db.name}</h3>
                <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                  MongoDB {db.version}
                </span>
              </div>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-white/80">
                <span
                  className={cn(
                    "inline-block h-2 w-2 rounded-full",
                    running ? "bg-emerald-300 shadow-[0_0_8px_#6ee7b7]" : "bg-white/40",
                  )}
                />
                {running ? "Studio running" : installed ? "Studio stopped" : "Studio not installed"} ·{" "}
                <span className="font-mono">db-{db.name}:{db.port}</span>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {running && studio?.url ? (
              <>
                <button
                  type="button"
                  onClick={() => window.open(studio.url as string, "_blank", "noopener,noreferrer")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-white px-3.5 text-xs font-semibold text-[#0049e8] shadow-sm transition hover:bg-white/90"
                >
                  <ExternalLink size={13} /> Open Studio
                </button>
                <button
                  type="button"
                  disabled={busy === `mongo-stop-${db.name}`}
                  onClick={onStop}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/30 bg-white/10 px-3 text-xs font-medium text-white transition hover:bg-white/20 disabled:opacity-50"
                >
                  <Square size={12} /> Stop
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={busy === `mongo-start-${db.name}`}
                onClick={onStart}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-white px-3.5 text-xs font-semibold text-[#0049e8] shadow-sm transition hover:bg-white/90 disabled:opacity-50"
              >
                <Play size={13} />
                {busy === `mongo-start-${db.name}`
                  ? "Starting..."
                  : installed
                    ? "Start Studio"
                    : "Install & Start Studio"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="space-y-3 p-5">
        {studio?.error && (
          <p className="rounded-[var(--radius)] border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-500 dark:text-amber-300">
            {studio.error}
          </p>
        )}

        {studio?.username && studio?.password ? (
          <div className="space-y-2 rounded-[var(--radius)] border border-border/70 bg-muted/40 p-3.5 font-mono text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Username
              </span>
              <div className="flex items-center gap-2">
                <Code>{studio.username}</Code>
                <button
                  type="button"
                  className="rounded-lg p-1 text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                  onClick={() => void copy("user", studio.username)}
                  aria-label="Copy studio username"
                >
                  {copied === "user" ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-border/50 pt-2">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Password
              </span>
              <div className="flex items-center gap-1.5">
                <span className="max-w-[180px] truncate font-semibold text-primary">
                  {reveal ? studio.password : "••••••••••••••••"}
                </span>
                <button
                  type="button"
                  className="rounded-lg p-1 text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                  onClick={() => setReveal((v) => !v)}
                  aria-label="Toggle studio password"
                >
                  {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button
                  type="button"
                  className="rounded-lg p-1 text-muted-foreground transition hover:bg-primary/10 hover:text-primary"
                  onClick={() => void copy("pass", studio.password)}
                  aria-label="Copy studio password"
                >
                  {copied === "pass" ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-[var(--radius)] border border-dashed border-border px-4 py-5 text-center text-xs text-muted-foreground">
            Click <strong className="text-foreground">Install &amp; Start Studio</strong> to launch mongo-express and generate your encrypted access credentials.
          </div>
        )}

        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ShieldCheck size={14} className="shrink-0 text-primary" />
            Protected by Traefik basic auth at <Code>/mongo/{db.name}/</Code>
          </span>
        </div>
      </div>
    </GlassPanel>
  );
}

function NewDbModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate(name);
      setName("");
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
      title="New MySQL database"
      description="Created on the panel's own MySQL server. Lowercase letters, numbers, underscore."
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Database name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="blog_db" required />
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
            <Plus size={13} /> Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function NewUserModal({
  open,
  onClose,
  databases,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  databases: string[];
  onCreate: (name: string, databases: string[]) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(db: string) {
    setSelected((cur) => (cur.includes(db) ? cur.filter((d) => d !== db) : [...cur, db]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate(name, selected);
      setName("");
      setSelected([]);
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
      title="New MySQL user"
      description="A strong password is generated for you and shown once after creation."
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Username">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="blog_user" required />
        </Field>
        <Field label="Grant access to">
          {databases.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 px-3 py-3 text-center text-xs text-slate-500">
              No managed databases yet — the user will be created without grants.
            </p>
          ) : (
            <div className="max-h-40 space-y-1.5 overflow-y-auto rounded-xl border border-white/10 bg-ink-950/40 p-2.5">
              {databases.map((db) => (
                <label key={db} className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={selected.includes(db)}
                    onChange={() => toggle(db)}
                    className="h-3.5 w-3.5 accent-brand-500"
                  />
                  <Code>{db}</Code>
                </label>
              ))}
            </div>
          )}
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
            <UserPlus size={13} /> Create user
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ImportModal({
  dbName,
  onClose,
  onImport,
}: {
  dbName: string | null;
  onClose: () => void;
  onImport: (name: string, sql: string) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !dbName) return;
    setBusy(true);
    setError(null);
    try {
      const text = await file.text();
      await onImport(dbName, text);
      setFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={Boolean(dbName)}
      onClose={onClose}
      title={`Import SQL · ${dbName ?? ""}`}
      description="Upload a .sql dump (max 64 MB). The dump's own DROP/CREATE statements are applied."
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="SQL dump file">
          <input
            type="file"
            accept=".sql,.txt"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full rounded-xl border border-white/10 bg-ink-950/40 px-3 py-2.5 text-xs text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-1.5 file:text-xs file:text-white"
          />
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
          <Button type="submit" size="sm" loading={busy} disabled={!file}>
            <Upload size={13} /> Import
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DbCard({
  db,
  publicIp,
  busy,
  onAction,
}: {
  db: DatabaseRow;
  publicIp: string | null;
  busy: string | null;
  onAction: (key: string, action: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
  const [reveal, setReveal] = useState(false);
  const host = db.remote ? publicIp || "<server-ip>" : `db-${db.name}`;

  return (
    <GlassPanel
      className="space-y-3 p-5"
      accent={db.engine === "mongo" ? "cyan" : "blue"}
      interactive={false}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-brand-400">
            <Database size={16} />
          </span>
          <div>
            <div className="flex items-center gap-2">
              <StatusDot ok={db.status === "running"} />
              <h3 className="text-sm font-semibold text-white">{db.name}</h3>
              <Badge tone="info">
                {db.engine} {db.version}
              </Badge>
              {db.remote === 1 && <Badge tone="warn">public</Badge>}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              internal host <Code>{`db-${db.name}`}</Code> · port {db.port}
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onAction(`restart-${db.name}`, "db.restart", { name: db.name })}
            loading={busy === `restart-${db.name}`}
          >
            <RefreshCw size={13} />
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              if (confirm(`Delete ${db.name}? The volume and all data are removed.`)) {
                void onAction(`delete-${db.name}`, "db.delete", { name: db.name });
              }
            }}
            loading={busy === `delete-${db.name}`}
          >
            <Trash2 size={13} />
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-white/5 bg-ink-950/50 p-3 font-mono text-[11px] leading-relaxed text-slate-400">
        <div>
          DB_HOST=<span className="text-brand-400">{host}</span>
        </div>
        <div>
          DB_PORT=<span className="text-brand-400">{db.remote ? db.public_port : db.port}</span>
        </div>
        <div>
          DB_DATABASE=<span className="text-brand-400">{db.dbname}</span>
        </div>
        <div>
          DB_USERNAME=<span className="text-brand-400">{db.username}</span>
        </div>
        <div>
          DB_PASSWORD=
          <span className="text-brand-400">{reveal ? db.password : "••••••••••••"}</span>
          <button
            onClick={() => setReveal((v) => !v)}
            className="ml-2 inline-flex align-middle text-slate-500 hover:text-white"
            aria-label="Toggle password"
          >
            {reveal ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {db.remote ? (
          <Button
            size="sm"
            variant="ghost"
            loading={busy === `unexpose-${db.name}`}
            onClick={() => onAction(`unexpose-${db.name}`, "db.unexpose", { name: db.name })}
          >
            <Globe2 size={13} /> Remove public access
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            loading={busy === `expose-${db.name}`}
            onClick={() => onAction(`expose-${db.name}`, "db.expose", { name: db.name })}
          >
            <Globe2 size={13} /> Expose remotely
          </Button>
        )}
        <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
          <KeyRound size={11} /> user <Code>{db.username}</Code>
        </span>
      </div>
    </GlassPanel>
  );
}

function CreateDatabaseModal({
  open,
  onClose,
  engines,
  publicIp,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  engines: DbEngine[];
  publicIp: string | null;
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [engineId, setEngineId] = useState("mysql");
  const [version, setVersion] = useState("");
  const [remote, setRemote] = useState(false);
  const [publicPort, setPublicPort] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const engine = engines.find((e) => e.id === engineId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        name,
        engine: engineId,
        version: version || engine?.versions[0],
        remote,
        publicPort: publicPort ? Number(publicPort) : undefined,
      });
      setName("");
      setVersion("");
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
      title="New database"
      description="Credentials are generated for you and stored in the panel. The volume survives restarts."
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="main" required />
          </Field>
          <Field label="Engine">
            <Select value={engineId} onChange={(e) => setEngineId(e.target.value)}>
              {engines.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Version">
            <Select value={version} onChange={(e) => setVersion(e.target.value)}>
              {(engine?.versions ?? []).map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Public port"
            hint={remote ? `Clients connect to ${publicIp || "<server-ip>"}:<port>` : "Only used when exposed"}
          >
            <Input
              type="number"
              value={publicPort}
              onChange={(e) => setPublicPort(e.target.value)}
              placeholder="33061"
              disabled={!remote}
            />
          </Field>
        </div>

        <label className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-ink-950/40 p-3">
          <input
            type="checkbox"
            checked={remote}
            onChange={(e) => setRemote(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-brand-500"
          />
          <span>
            <span className="block text-xs font-medium text-slate-200">Allow remote connections</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-500">
              Publishes the port on 0.0.0.0 and creates a user allowed from any host. Use a strong
              password and a firewall rule.
            </span>
          </span>
        </label>

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
            <Plus size={13} /> Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AddTargetModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState({ name: "", host: "", port: "3306", username: "root", password: "", ssl: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onCreate({ ...form, port: Number(form.port) });
      setForm({ name: "", host: "", port: "3306", username: "root", password: "", ssl: true });
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
      title="Attach external MySQL"
      description="Manage a MySQL/MariaDB server that runs outside this panel."
    >
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Label">
            <Input value={form.name} onChange={set("name")} placeholder="production-db" required />
          </Field>
          <Field label="Host">
            <Input value={form.host} onChange={set("host")} placeholder="db.example.com" required />
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Port">
            <Input type="number" value={form.port} onChange={set("port")} />
          </Field>
          <Field label="Username">
            <Input value={form.username} onChange={set("username")} required />
          </Field>
          <Field label="Password">
            <Input type="password" value={form.password} onChange={set("password")} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={form.ssl}
            onChange={(e) => setForm((f) => ({ ...f, ssl: e.target.checked }))}
            className="h-4 w-4 accent-brand-500"
          />
          Connect over TLS
        </label>

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
            Attach
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function SqlConsole({
  target,
  onClose,
  run,
}: {
  target: TargetRow | null;
  onClose: () => void;
  run: <T = unknown>(action: string, payload?: Record<string, unknown>) => Promise<T>;
}) {
  const [sql, setSql] = useState("SHOW DATABASES;");
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function execute() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await run<{ rows: Record<string, unknown>[]; truncated: boolean }>("target.query", {
        id: target.id,
        sql,
      });
      setRows(res.rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRows(null);
    } finally {
      setBusy(false);
    }
  }

  const columns = rows?.[0] ? Object.keys(rows[0]) : [];

  return (
    <Modal
      open={Boolean(target)}
      onClose={onClose}
      title={`SQL console · ${target?.name ?? ""}`}
      description="Read-only: SELECT, SHOW, DESCRIBE and EXPLAIN."
      wide
    >
      <textarea
        value={sql}
        onChange={(e) => setSql(e.target.value)}
        className="min-h-[100px] w-full rounded-xl border border-white/10 bg-ink-950 p-3 font-mono text-xs text-slate-200 outline-none focus:border-brand-500/50"
        spellCheck={false}
      />
      <div className="flex justify-end">
        <Button size="sm" onClick={execute} loading={busy}>
          Run query
        </Button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {rows && (
        <div className="max-h-[46vh] overflow-auto rounded-xl border border-white/5">
          <table className="w-full text-left font-mono text-[11px]">
            <thead className="sticky top-0 bg-ink-850 text-slate-400">
              <tr>
                {columns.map((c) => (
                  <th key={c} className="whitespace-nowrap px-3 py-2 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((row, i) => (
                <tr key={i} className="text-slate-300">
                  {columns.map((c) => (
                    <td key={c} className="max-w-[280px] truncate px-3 py-1.5">
                      {String(row[c] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
