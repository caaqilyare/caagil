"use client";

import { useState } from "react";
import {
  Database,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Plus,
  RefreshCw,
  Server,
  Terminal,
  Trash2,
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
} from "@/components/ui";
import { usePanel } from "@/lib/client";
import type { DatabaseRow, TargetRow } from "@/lib/ops";
import type { DbEngine } from "@/lib/presets";

export default function DatabasesPage() {
  const { state, loading, act } = usePanel();
  const [createOpen, setCreateOpen] = useState(false);
  const [targetOpen, setTargetOpen] = useState(false);
  const [consoleFor, setConsoleFor] = useState<TargetRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, action: string, payload: Record<string, unknown> = {}) {
    setBusy(key);
    setError(null);
    try {
      await act(action, payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

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
        <div className="grid gap-3 lg:grid-cols-2">
          {state.databases.map((db) => (
            <DbCard
              key={db.id}
              db={db}
              publicIp={state.publicIp}
              busy={busy}
              onAction={run}
            />
          ))}
        </div>
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

      <SqlConsole target={consoleFor} onClose={() => setConsoleFor(null)} run={act} />
    </>
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
    <Card className="animate-fade-up space-y-3">
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
    </Card>
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
