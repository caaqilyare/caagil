"use client";

import { useState } from "react";
import {
  Boxes,
  Check,
  Copy,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode2,
  FolderOpen,
  GitBranch,
  Globe,
  KeyRound,
  Link2,
  Play,
  Plus,
  RefreshCw,
  ScrollText,
  Square,
  Trash2,
} from "lucide-react";
import { PageHeader } from "@/components/shell";
import { FileManager } from "@/components/file-manager";
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
  Textarea,
} from "@/components/ui";
import { usePanel } from "@/lib/client";
import type { AppDbRow, AppRow } from "@/lib/ops";
import type { DomainRow } from "@/lib/client";
import type { RuntimePreset } from "@/lib/presets";

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    out[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return out;
}

function generatePassword(length = 16): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

const isWpApp = (app: { runtime: string; image: string }) =>
  /wordpress/i.test(`${app.runtime} ${app.image}`);

export default function AppsPage() {
  const { state, loading, act } = usePanel();
  const [open, setOpen] = useState(false);
  const [logsFor, setLogsFor] = useState<AppRow | null>(null);
  const [routeFor, setRouteFor] = useState<AppRow | null>(null);
  const [filesFor, setFilesFor] = useState<AppRow | null>(null);
  const [domainsFor, setDomainsFor] = useState<AppRow | null>(null);
  const [wpFor, setWpFor] = useState<AppRow | null>(null);
  const [logs, setLogs] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(name: string, action: string, payload: Record<string, unknown> = {}) {
    setBusy(name);
    setError(null);
    try {
      const result = await act<{ warning?: string | null }>(action, { name, ...payload });
      if (result?.warning) setError(`Deleted, but ${result.warning}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function showLogs(app: AppRow) {
    setLogsFor(app);
    setLogs("loading…");
    try {
      const res = await act<{ logs: string }>("app.logs", { name: app.name, lines: 400 });
      setLogs(res.logs || "(no output)");
    } catch (err) {
      setLogs(err instanceof Error ? err.message : String(err));
    }
  }

  const knownHosts = Array.from(
    new Set([
      ...(state?.panel.domain ? [state.panel.domain] : []),
      ...(state?.domains.map((domain) => domain.host) ?? []),
    ]),
  );

  return (
    <>
      <PageHeader
        title="Applications"
        subtitle="PHP, Node.js, static sites and custom Docker images behind Traefik."
        action={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus size={14} /> New application
          </Button>
        }
      />

      {error && (
        <p className="mb-4 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {loading || !state ? (
        <div className="h-52 animate-pulse rounded-2xl border border-white/5 bg-ink-900/40" />
      ) : state.apps.length === 0 ? (
        <Empty
          title="No applications yet"
          hint="Pick a PHP version, clone a Git repo and you are live in under a minute."
          action={
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus size={14} /> Create application
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {state.apps.map((app) => (
            <Card key={app.id} className="animate-fade-up">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusDot ok={app.status === "running"} />
                    <h3 className="truncate text-sm font-semibold text-white">{app.name}</h3>
                    <Badge tone={app.status === "running" ? "ok" : app.status === "error" ? "bad" : "neutral"}>
                      {app.status}
                    </Badge>
                    <Badge tone="info">{app.runtime}</Badge>
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    <span className="font-mono">{app.image}</span>
                    <span>port {app.port}</span>
                    {app.git_url && (
                      <span className="inline-flex items-center gap-1">
                        <GitBranch size={11} /> {app.branch || "main"}
                      </span>
                    )}
                    {app.doc_root && (
                      <span className="inline-flex items-center gap-1">
                        <FileCode2 size={11} /> {app.doc_root}
                      </span>
                    )}
                  </p>
                  {app.domain && (
                    <a
                      href={`https://${app.domain}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 text-xs text-brand-400 hover:underline"
                    >
                      {app.domain} <ExternalLink size={11} />
                    </a>
                  )}
                  {app.path_prefix && (
                    <a
                      href={`https://${app.path_host}${app.path_prefix}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 ml-3 inline-flex items-center gap-1 text-xs text-sky-300 hover:underline"
                    >
                      <Link2 size={11} /> {app.path_host}
                      {app.path_prefix}
                    </a>
                  )}
                  {isWpApp(app) && (
                    <a
                      href={
                        app.domain
                          ? `https://${app.domain}/wp-admin`
                          : `https://${app.path_host}${app.path_prefix}/wp-admin`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 ml-3 inline-flex items-center gap-1 text-xs text-amber-300 hover:underline"
                    >
                      <KeyRound size={11} /> wp-admin
                    </a>
                  )}
                  {app.wp_db && <DbCredentials db={app.wp_db} />}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {isWpApp(app) && (
                    <Button size="sm" variant="ghost" onClick={() => setWpFor(app)}>
                      <KeyRound size={13} /> WP
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => showLogs(app)}>
                    <ScrollText size={13} /> Logs
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRouteFor(app)}>
                    <Link2 size={13} /> Path
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDomainsFor(app)}>
                    <Globe size={13} /> Domains
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setFilesFor(app)}>
                    <FolderOpen size={13} /> Files
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === `restart-${app.name}`}
                    onClick={() => run(`restart-${app.name}`, "app.restart", { name: app.name })}
                  >
                    <RefreshCw size={13} /> Restart
                  </Button>
                  {app.status === "running" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === `stop-${app.name}`}
                      onClick={() => run(`stop-${app.name}`, "app.stop", { name: app.name })}
                    >
                      <Square size={12} /> Stop
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === `start-${app.name}`}
                      onClick={() => run(`start-${app.name}`, "app.start", { name: app.name })}
                    >
                      <Play size={12} /> Start
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="subtle"
                    loading={busy === `redeploy-${app.name}`}
                    onClick={() => run(`redeploy-${app.name}`, "app.redeploy", { name: app.name })}
                  >
                    <RefreshCw size={13} /> Redeploy
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    loading={busy === `delete-${app.name}`}
                    onClick={() => {
                      if (confirm(`Delete ${app.name}? Container and source files are removed.`)) {
                        void run(`delete-${app.name}`, "app.delete", { name: app.name });
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <CreateAppModal
        open={open}
        onClose={() => setOpen(false)}
        presets={state?.presets ?? []}
        hosts={knownHosts}
        userEmail={state?.user.email ?? ""}
        onCreate={async (payload) => {
          await act("app.create", payload);
          setOpen(false);
        }}
      />

      <Modal
        open={Boolean(logsFor)}
        onClose={() => setLogsFor(null)}
        title={`Logs · ${logsFor?.name ?? ""}`}
        wide
        footer={
          <Button
            size="sm"
            variant="ghost"
            onClick={() => logsFor && showLogs(logsFor)}
          >
            <RefreshCw size={13} /> Refresh
          </Button>
        }
      >
        <pre className="max-h-[60vh] overflow-auto rounded-xl bg-ink-950 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
          {logs}
        </pre>
      </Modal>
      {routeFor && (
        <RouteModal
          key={routeFor.id}
          app={routeFor}
          hosts={knownHosts}
          onClose={() => setRouteFor(null)}
          onSave={async (payload) => {
            await act("app.route", { name: routeFor.name, ...payload });
            setRouteFor(null);
          }}
        />
      )}

      {filesFor && <FileManager key={filesFor.id} app={filesFor.name} onClose={() => setFilesFor(null)} />}

      {domainsFor && (
        <DomainsModal
          key={domainsFor.id}
          app={domainsFor}
          domains={state?.domains ?? []}
          hosts={knownHosts}
          onClose={() => setDomainsFor(null)}
        />
      )}

      {wpFor && (
        <WpInstallModal
          key={wpFor.id}
          app={wpFor}
          userEmail={state?.user.email ?? ""}
          onClose={() => setWpFor(null)}
        />
      )}
    </>
  );
}

function CreateAppModal({
  open,
  onClose,
  presets,
  hosts,
  userEmail,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  presets: RuntimePreset[];
  hosts: string[];
  userEmail: string;
  onCreate: (payload: Record<string, unknown>) => Promise<{ wp_warning?: string | null } | void>;
}) {
  const [name, setName] = useState("");
  const [presetId, setPresetId] = useState("php84");
  const [gitUrl, setGitUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [domain, setDomain] = useState("");
  const [pathPrefix, setPathPrefix] = useState("");
  const [pathHost, setPathHost] = useState("");
  const [stripPrefix, setStripPrefix] = useState(true);
  const [port, setPort] = useState("");
  const [image, setImage] = useState("");
  const [envText, setEnvText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const [wpAuto, setWpAuto] = useState(true);
  const [wpTitle, setWpTitle] = useState("");
  const [wpUser, setWpUser] = useState("admin");
  const [wpPass, setWpPass] = useState(() => generatePassword());
  const [wpShowPass, setWpShowPass] = useState(false);
  const [wpEmail, setWpEmail] = useState(userEmail);

  const preset = presets.find((p) => p.id === presetId);
  const isCustom = presetId === "custom";
  const isWp = presetId === "wordpress";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const res = await onCreate({
        name,
        preset: presetId,
        image: isCustom ? image : undefined,
        port: port ? Number(port) : undefined,
        gitUrl: gitUrl || undefined,
        branch: gitUrl ? branch : undefined,
        domain: domain || undefined,
        pathPrefix: pathPrefix || undefined,
        pathHost: pathHost || undefined,
        stripPrefix,
        env: parseEnv(envText),
        wp: isWp
          ? {
              autoInstall: wpAuto,
              title: wpTitle || name,
              adminUser: wpUser || "admin",
              adminPassword: wpPass,
              adminEmail: wpEmail || userEmail,
            }
          : undefined,
      });
      if (res?.wp_warning) {
        setWarning(res.wp_warning);
      } else {
        setName("");
        setGitUrl("");
        setDomain("");
        setPathPrefix("");
        setPathHost("");
        setEnvText("");
        setWpPass(generatePassword());
        onClose();
      }
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
      title="New application"
      description="A container, a Traefik route and an optional SSL certificate — all wired automatically."
      wide
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" hint="Lowercase letters, numbers and dashes.">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-blog" required />
          </Field>
          <Field label="Runtime">
            <Select value={presetId} onChange={(e) => setPresetId(e.target.value)}>
              {presets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {preset && <p className="text-[11px] leading-relaxed text-slate-500">{preset.description}</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Git repository" hint="Optional. Public or private over SSH keys on the server.">
            <Input
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              placeholder="https://github.com/you/site.git"
            />
          </Field>
          <Field label="Branch">
            <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Domain"
            hint="Pick an existing domain or type a new one. Traefik requests the certificate automatically."
          >
            <Input
              list="caagil-domain-options"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="app.example.com"
            />
          </Field>
          <Field label="Container port" hint={preset ? `Preset default: ${preset.port}` : undefined}>
            <Input
              type="number"
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder={String(preset?.port ?? 80)}
            />
          </Field>
        </div>

        <datalist id="caagil-domain-options">
          {hosts.map((host) => (
            <option key={host} value={host} />
          ))}
        </datalist>

        <div className="rounded-xl border border-white/5 bg-ink-950/50 p-3">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            <Link2 size={12} /> Path route (optional)
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Path" hint="Serve the app at https://host/path, e.g. /blog.">
              <Input value={pathPrefix} onChange={(e) => setPathPrefix(e.target.value)} placeholder="/blog" />
            </Field>
            <Field label="Host" hint="Defaults to this panel's domain.">
              <Input
                list="caagil-domain-options"
                value={pathHost}
                onChange={(e) => setPathHost(e.target.value)}
                placeholder="panel.example.com"
              />
            </Field>
          </div>
          {pathPrefix && (
            <p className="mt-2 rounded-lg bg-ink-950/60 px-3 py-2 text-[11px] text-slate-400">
              <Link2 size={11} className="mr-1 inline" />
              https://{pathHost || hosts[0] || "<panel-domain>"}
              {pathPrefix.startsWith("/") ? pathPrefix : `/${pathPrefix}`}
            </p>
          )}
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <input
              type="checkbox"
              checked={stripPrefix}
              onChange={(e) => setStripPrefix(e.target.checked)}
              className="h-3.5 w-3.5 accent-brand-500"
            />
            Strip the path prefix before proxying
          </label>
        </div>

        {isWp && (
          <div className="space-y-3 rounded-xl border border-brand-500/25 bg-brand-500/5 p-3">
            <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-brand-300">
              <KeyRound size={12} /> WordPress one-click install
            </p>
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={wpAuto}
                onChange={(e) => setWpAuto(e.target.checked)}
                className="h-3.5 w-3.5 accent-brand-500"
              />
              Auto-install with its own MySQL database, admin account and SSL URL (recommended)
            </label>
            {wpAuto && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Site title">
                    <Input
                      value={wpTitle}
                      onChange={(e) => setWpTitle(e.target.value)}
                      placeholder={name || "My WordPress site"}
                    />
                  </Field>
                  <Field label="Admin username">
                    <Input value={wpUser} onChange={(e) => setWpUser(e.target.value)} placeholder="admin" />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Admin password" hint="Copy it now — you need it to log in to wp-admin.">
                    <div className="flex gap-1.5">
                      <Input
                        type={wpShowPass ? "text" : "password"}
                        value={wpPass}
                        onChange={(e) => setWpPass(e.target.value)}
                        className="font-mono"
                      />
                      <Button type="button" variant="ghost" size="sm" onClick={() => setWpPass(generatePassword())}>
                        <RefreshCw size={13} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setWpShowPass((v) => !v)}
                      >
                        {wpShowPass ? <EyeOff size={13} /> : <Eye size={13} />}
                      </Button>
                    </div>
                  </Field>
                  <Field label="Admin email">
                    <Input
                      type="email"
                      value={wpEmail}
                      onChange={(e) => setWpEmail(e.target.value)}
                      placeholder={userEmail || "you@example.com"}
                    />
                  </Field>
                </div>
                <p className="text-[11px] leading-relaxed text-slate-500">
                  A database <Code>wp_{name || "&lt;name&gt;"}</Code> is created on the panel MySQL
                  server. If you do not pick a domain or path, the site is served at{" "}
                  <Code>
                    {hosts[0] || "&lt;panel-domain&gt;"}/{name || "&lt;name&gt;"}
                  </Code>
                  . The install finishes about a minute after the container starts.
                </p>
              </>
            )}
          </div>
        )}

        {isCustom && (
          <Field label="Docker image" hint="Any image that listens on the port above.">
            <Input value={image} onChange={(e) => setImage(e.target.value)} placeholder="ghcr.io/you/app:latest" />
          </Field>
        )}

        <Field
          label="Environment variables"
          hint="One KEY=VALUE per line. For MySQL use DB_HOST=db-<name>, DB_PORT=3306, DB_DATABASE, DB_USERNAME, DB_PASSWORD."
        >
          <Textarea
            value={envText}
            onChange={(e) => setEnvText(e.target.value)}
            className="font-mono text-xs"
            placeholder={"APP_ENV=production\nDB_HOST=db-main"}
          />
        </Field>

        {error && (
          <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        {warning && (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
            <p>{warning}</p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-1"
              onClick={() => {
                setWarning(null);
                onClose();
              }}
            >
              Close
            </Button>
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <Copy size={12} /> Files live in <Code>data/sites/{name || "<name>"}</Code>
          </p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={busy}>
              <Boxes size={13} /> Deploy
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function RouteModal({
  app,
  hosts,
  onClose,
  onSave,
}: {
  app: AppRow;
  hosts: string[];
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [path, setPath] = useState(app.path_prefix ?? "");
  const [host, setHost] = useState(app.path_host ?? "");
  const [strip, setStrip] = useState(Number(app.strip_prefix) !== 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave({ path, host: host || null, strip });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Path routing · ${app.name}`}
      description="Serve this app under a path prefix on the panel domain or another host."
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Path" hint="Empty removes the path route.">
            <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/blog" />
          </Field>
          <Field label="Host" hint="Defaults to this panel's domain.">
            <Input
              list="caagil-route-hosts"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="panel.example.com"
            />
          </Field>
        </div>

        <datalist id="caagil-route-hosts">
          {hosts.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>

        <label className="flex items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={strip}
            onChange={(e) => setStrip(e.target.checked)}
            className="h-3.5 w-3.5 accent-brand-500"
          />
          Strip the path prefix before proxying
        </label>

        {path && (
          <p className="rounded-lg bg-ink-950/60 px-3 py-2 text-[11px] text-slate-400">
            <Link2 size={11} className="mr-1 inline" />
            https://{host || "<panel-domain>"}
            {path}
          </p>
        )}

        {error && (
          <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={busy}>
            <Link2 size={13} /> Save route
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DomainsModal({
  app,
  domains,
  hosts,
  onClose,
}: {
  app: AppRow;
  domains: DomainRow[];
  hosts: string[];
  onClose: () => void;
}) {
  const { act } = usePanel();
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mine = domains.filter((domain) => domain.app_id === app.id);
  const free = hosts.filter((item) => !domains.some((domain) => domain.host === item));

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!host.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await act("domain.add", { host: host.trim(), app: app.id });
      setHost("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await act("domain.remove", { id });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Domains · ${app.name}`}
      description="Attach one or many hostnames. DNS must point at this server; certificates are automatic."
    >
      <form onSubmit={add} className="flex flex-col gap-2 sm:flex-row">
        <Input
          list="caagil-domain-picker"
          value={host}
          onChange={(e) => setHost(e.target.value)}
          placeholder="new or existing domain"
          className="flex-1"
        />
        <datalist id="caagil-domain-picker">
          {free.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
        <Button type="submit" size="sm" loading={busy}>
          <Plus size={13} /> Attach
        </Button>
      </form>

      <div className="space-y-2">
        {mine.length === 0 && (
          <p className="rounded-xl border border-dashed border-white/10 px-3 py-6 text-center text-xs text-slate-500">
            No domains yet. Type a new one above or pick an unassigned domain.
          </p>
        )}
        {mine.map((domain) => (
          <div
            key={domain.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-ink-950/40 px-3 py-2"
          >
            <div className="min-w-0">
              <p className="truncate text-xs text-slate-200">{domain.host}</p>
              <p className="text-[10px] text-slate-500">
                {domain.cert} {app.domain === domain.host ? "· primary" : ""}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void remove(domain.id)}
            >
              <Trash2 size={13} />
            </Button>
          </div>
        ))}
      </div>

      <p className="text-[11px] leading-relaxed text-slate-500">
        Tip: to serve this app at <span className="text-slate-300">domain/name</span>, use the Path
        button instead of attaching a domain.
      </p>

      {error && (
        <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}
    </Modal>
  );
}

function DbCredentials({ db }: { db: AppDbRow }) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard
      ?.writeText(`host: ${db.host}\ndatabase: ${db.name}\nuser: ${db.username}\npassword: ${db.password}`)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-white/5 bg-ink-950/50 px-2.5 py-1.5 text-[11px]">
      <span className="flex items-center gap-1 font-medium text-slate-300">
        <Database size={11} /> MySQL
      </span>
      <Code>{db.name}</Code>
      <span className="text-slate-500">user</span>
      <Code>{db.username}</Code>
      <span className="text-slate-500">pass</span>
      <Code>{show ? db.password : "••••••••••"}</Code>
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="text-slate-500 hover:text-slate-300"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff size={12} /> : <Eye size={12} />}
      </button>
      <button
        type="button"
        onClick={copy}
        className="text-slate-500 hover:text-slate-300"
        aria-label="Copy database credentials"
      >
        {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
      </button>
      <span className="text-slate-600">{db.host}</span>
    </div>
  );
}

function WpInstallModal({
  app,
  userEmail,
  onClose,
}: {
  app: AppRow;
  userEmail: string;
  onClose: () => void;
}) {
  const { act } = usePanel();
  const [title, setTitle] = useState(app.name);
  const [adminUser, setAdminUser] = useState("admin");
  const [adminPass, setAdminPass] = useState(() => generatePassword());
  const [showPass, setShowPass] = useState(false);
  const [email, setEmail] = useState(userEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ url: string; adminUser: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await act<{ url: string; adminUser: string }>("app.wpinstall", {
        name: app.name,
        title,
        adminUser: adminUser || "admin",
        adminPassword: adminPass,
        adminEmail: email || userEmail,
      });
      setDone(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`WordPress install · ${app.name}`}
      description="Creates the database tables, the site and an admin account on the running app."
    >
      {done ? (
        <div className="space-y-3">
          <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            WordPress is installed and ready.
          </p>
          <p className="text-xs text-slate-400">
            Site: <Code>{done.url}</Code>
            <br />
            Admin user: <Code>{done.adminUser}</Code> — the password is the one you entered.
          </p>
          <div className="flex justify-end gap-2">
            <a
              href={`${done.url}/wp-admin`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/5"
            >
              <ExternalLink size={12} /> Open wp-admin
            </a>
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Site title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={app.name} />
            </Field>
            <Field label="Admin username">
              <Input value={adminUser} onChange={(e) => setAdminUser(e.target.value)} placeholder="admin" />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Admin password" hint="You will use this to log in to wp-admin.">
              <div className="flex gap-1.5">
                <Input
                  type={showPass ? "text" : "password"}
                  value={adminPass}
                  onChange={(e) => setAdminPass(e.target.value)}
                  className="font-mono"
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => setAdminPass(generatePassword())}>
                  <RefreshCw size={13} />
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowPass((v) => !v)}>
                  {showPass ? <EyeOff size={13} /> : <Eye size={13} />}
                </Button>
              </div>
            </Field>
            <Field label="Admin email">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={userEmail || "you@example.com"}
              />
            </Field>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            If the app already has an admin user, this creates a second one. The site URL is taken
            from the app&apos;s domain or path route.
          </p>

          {error && (
            <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={busy}>
              <KeyRound size={13} /> Install WordPress
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
