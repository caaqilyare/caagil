"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  Copy,
  Globe,
  KeyRound,
  Lock,
  RefreshCw,
  Save,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  User,
  X,
} from "lucide-react";
import { Badge, Button, Code, Field, Input, Select, cn } from "@/components/ui";
import { SslBadge, SslFixModal, useSslStatus } from "@/components/ssl";
import { UpdateCard } from "@/components/update-card";
import { usePanel } from "@/lib/client";
import { CAAQIL_VERSION } from "@/lib/version";

export default function SettingsPage() {
  const { state, act } = usePanel();
  const { map: sslMap, refresh: sslRefresh } = useSslStatus(Boolean(state));
  const [sslFor, setSslFor] = useState<string | null>(null);

  const [panelName, setPanelName] = useState("");
  const [panelDomain, setPanelDomain] = useState("");
  const [publicIp, setPublicIp] = useState("");
  const [allowIp, setAllowIp] = useState(false);
  const [provider, setProvider] = useState("deepseek");
  const [model, setModel] = useState("deepseek-chat");
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [accessUrl, setAccessUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Modals state
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);

  useEffect(() => {
    if (!state) return;
    setPanelName(state.panel.name);
    setPanelDomain(state.panel.domain ?? "");
    setPublicIp(state.publicIp ?? "");
    setAllowIp(state.panel.allowIp);
    setProvider(state.ai.provider);
    setModel(state.ai.model);
  }, [state]);

  const providerMeta = state?.providers.find((p) => p.id === provider);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    setAccessUrl("");
    try {
      const result = await act<{
        access?: { url: string; movedRoutes: number };
      }>("settings.save", {
        panelName,
        panelDomain,
        publicIp,
        allowIpAccess: allowIp,
        aiProvider: provider,
        aiModel: model,
        keys: Object.fromEntries(Object.entries(keys).filter(([, v]) => v !== "")),
      });
      setSaved(true);
      setAccessUrl(result?.access?.url ?? "");
      setKeys({});
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative space-y-6 pb-12">
      {/* Settings Top Header with Version Pill */}
      <div className="relative overflow-hidden rounded-3xl border border-white/15 bg-gradient-to-br from-white/[0.09] via-white/[0.04] to-white/[0.01] p-6 backdrop-blur-3xl shadow-[0_16px_50px_0_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(255,255,255,0.25)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/30 to-transparent" />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2.5 mb-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-3 py-0.5 text-xs font-semibold text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.25)]">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                v{CAAQIL_VERSION}
              </span>
              <span className="text-xs text-slate-400 font-mono">Production Edition</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white drop-shadow-sm">
              Settings & Control
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Configure panel identity, credentials, AI models, and maintenance.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setProfileModalOpen(true)}
              className="glass-button h-9 px-3.5 text-xs font-semibold hover:border-emerald-500/30 hover:bg-emerald-500/10 hover:text-emerald-200"
            >
              <User size={13} className="text-emerald-400" /> Change Username
            </button>
            <button
              type="button"
              onClick={() => setPasswordModalOpen(true)}
              className="glass-button h-9 px-3.5 text-xs font-semibold hover:border-brand-500/30 hover:bg-brand-500/10 hover:text-brand-200"
            >
              <Lock size={13} className="text-brand-400" /> Change Password
            </button>
          </div>
        </div>
      </div>

      {/* Account Profile Bar */}
      {state && (
        <div className="glass-card p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-brand-400/20 via-emerald-500/10 to-transparent text-emerald-400 shadow-inner">
                <User size={20} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-white">{state.user.email}</p>
                  <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] font-mono text-slate-300 uppercase">
                    {state.user.role}
                  </span>
                </div>
                <p className="text-xs text-slate-400">Owner administrator account</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="subtle"
                onClick={() => setProfileModalOpen(true)}
              >
                <User size={13} /> Edit Account / Username
              </Button>
              <Button
                type="button"
                size="sm"
                variant="subtle"
                onClick={() => setPasswordModalOpen(true)}
              >
                <Lock size={13} /> Change Password
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Main Settings Form */}
      <form onSubmit={save} className="grid gap-6 lg:grid-cols-2">
        {/* Panel Identity Card */}
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-brand-400/20 bg-brand-400/10 text-brand-400">
              <Server size={14} />
            </span>
            <span>Panel Identity & Network</span>
          </div>

          <Field label="Panel Name">
            <Input
              value={panelName}
              onChange={(e) => setPanelName(e.target.value)}
              placeholder="Caaqil"
              className="bg-black/20 border-white/10"
            />
          </Field>

          <Field
            label="Panel Domain"
            hint="Served over HTTPS with auto-renewing Let's Encrypt certificates."
          >
            <div className="flex gap-2">
              <Input
                value={panelDomain}
                onChange={(e) => setPanelDomain(e.target.value)}
                placeholder="panel.example.com"
                className="bg-black/20 border-white/10"
              />
              {panelDomain && (
                <Button
                  type="button"
                  size="sm"
                  variant={sslMap[panelDomain]?.ok ? "ghost" : "subtle"}
                  onClick={() => (sslMap[panelDomain]?.ok ? void sslRefresh() : setSslFor(panelDomain))}
                  title={
                    sslMap[panelDomain]?.ok
                      ? "Certificate valid"
                      : (sslMap[panelDomain]?.reason ?? "Request an SSL certificate")
                  }
                >
                  <ShieldCheck size={13} /> SSL
                </Button>
              )}
            </div>
            {panelDomain && (
              <div className="mt-2">
                <SslBadge status={sslMap[panelDomain]} />
              </div>
            )}
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Public IP"
              hint="Used for database connection strings and IP routing."
            >
              <Input
                value={publicIp}
                onChange={(e) => setPublicIp(e.target.value)}
                placeholder="203.0.113.10"
                className="bg-black/20 border-white/10"
              />
            </Field>
            <Field label="IP Access" hint="Direct access at http://IP without domain.">
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={allowIp}
                  onChange={(e) => setAllowIp(e.target.checked)}
                  className="h-3.5 w-3.5 accent-brand-500 rounded"
                />
                Allow plain HTTP by IP
              </label>
            </Field>
          </div>

          {allowIp && (
            <p className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs leading-relaxed text-amber-200">
              Plain HTTP sends traffic unencrypted. Turn it off once HTTPS domain is operational.
            </p>
          )}

          {accessUrl && (
            <p className="rounded-xl border border-brand-500/25 bg-brand-500/10 p-3 text-xs leading-relaxed text-brand-200">
              <Globe size={12} className="mr-1.5 inline" /> Panel accessible at{" "}
              <a href={accessUrl} className="font-semibold underline">
                {accessUrl}
              </a>
            </p>
          )}

          {state && (
            <div className="space-y-1.5 rounded-xl border border-white/5 bg-black/30 p-3 text-xs font-mono text-slate-400">
              <p>Platform: <span className="text-slate-200">{state.stats.platform}</span></p>
              <p>Version: <span className="text-emerald-300 font-semibold">v{CAAQIL_VERSION}</span></p>
              <p>
                Docker:{" "}
                {state.stats.docker.ok ? (
                  <span className="text-emerald-400">connected · v{state.stats.docker.version}</span>
                ) : (
                  <span className="text-rose-400">offline</span>
                )}
              </p>
            </div>
          )}
        </div>

        {/* AI Operator Card */}
        <div className="glass-card p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-purple-400/20 bg-purple-400/10 text-purple-400">
              <Sparkles size={14} />
            </span>
            <span>AI Assistant Engine</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="AI Provider">
              <Select
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  const meta = state?.providers.find((p) => p.id === e.target.value);
                  if (meta) setModel(meta.models[0]);
                }}
                className="bg-black/20 border-white/10"
              >
                {state?.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Model">
              {providerMeta ? (
                <Select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="bg-black/20 border-white/10"
                >
                  {providerMeta.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="bg-black/20 border-white/10"
                />
              )}
            </Field>
          </div>

          <Field
            label={`${providerMeta?.label ?? provider} API Key`}
            hint="Stored encrypted in your MySQL database. Server-side only."
          >
            <Input
              type="password"
              value={keys[provider] ?? ""}
              onChange={(e) => setKeys((k) => ({ ...k, [provider]: e.target.value }))}
              placeholder="sk-…"
              autoComplete="off"
              className="bg-black/20 border-white/10 font-mono"
            />
          </Field>

          <p className="flex items-start gap-1.5 text-xs text-slate-400">
            <KeyRound size={13} className="mt-0.5 shrink-0 text-slate-500" />
            Keys never reach the browser after saving.
          </p>

          <div className="pt-4">
            <Button type="submit" loading={busy} className="w-full sm:w-auto">
              <Save size={14} /> Save Settings
            </Button>
            {saved && (
              <span className="ml-3 inline-flex items-center gap-1 text-xs text-emerald-400">
                <Check size={13} /> Settings saved successfully
              </span>
            )}
            {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
          </div>
        </div>
      </form>

      {/* Updates Card */}
      <div className="glass-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-brand-400/20 bg-brand-400/10 text-brand-400">
              <RefreshCw size={14} />
            </span>
            <span>Panel Updates & Rollback Safety Net</span>
          </div>
          <span className="text-xs font-mono text-slate-400">v{CAAQIL_VERSION}</span>
        </div>
        <p className="text-xs text-slate-400 leading-relaxed">
          Checks <Code>origin/main</Code> on GitHub. Cached builds execute in seconds. Automatic and 1-click manual rollback protect your panel from staying broken.
        </p>
        <UpdateCard />
      </div>

      {/* ⚠️ DANGER ZONE: Factory Reset */}
      <div className="relative overflow-hidden rounded-3xl border border-rose-500/25 bg-gradient-to-br from-rose-950/20 via-ink-950/40 to-ink-950/60 p-6 backdrop-blur-3xl shadow-[0_12px_40px_0_rgba(0,0,0,0.5),inset_0_1px_1px_rgba(244,63,94,0.15)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400">
                <ShieldAlert size={15} />
              </span>
              <h2 className="text-base font-bold text-white tracking-wide">
                Danger Zone: Factory Reset (Clean Slate)
              </h2>
            </div>
            <p className="text-xs text-rose-200/80 leading-relaxed max-w-2xl">
              Permanently erases all deployed applications, databases, custom domains, cron jobs, and backups. Restores the panel to a fresh empty state.
            </p>
            <p className="text-xs font-semibold text-amber-300/90 pt-1">
              ⚠️ Warning: Please create a full backup under Operations → Backups before proceeding!
            </p>
          </div>

          <Button
            type="button"
            variant="danger"
            onClick={() => setResetModalOpen(true)}
            className="shrink-0"
          >
            <Trash2 size={14} /> Reset Panel to Clean State…
          </Button>
        </div>
      </div>

      {/* Change Username / Email Modal */}
      {profileModalOpen && (
        <ChangeProfileModal
          currentEmail={state?.user.email ?? ""}
          onClose={() => setProfileModalOpen(false)}
        />
      )}

      {/* Change Password Modal */}
      {passwordModalOpen && (
        <ChangePasswordModal onClose={() => setPasswordModalOpen(false)} />
      )}

      {/* Factory Reset Confirmation Modal */}
      {resetModalOpen && (
        <FactoryResetModal onClose={() => setResetModalOpen(false)} />
      )}

      {sslFor && (
        <SslFixModal
          domain={sslFor}
          onClose={() => {
            setSslFor(null);
            void sslRefresh();
          }}
        />
      )}
    </div>
  );
}

/** Modal to Change Username / Account Email */
function ChangeProfileModal({
  currentEmail,
  onClose,
}: {
  currentEmail: string;
  onClose: () => void;
}) {
  const { act } = usePanel();
  const [email, setEmail] = useState(currentEmail);
  const [currentPassword, setCurrentPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await act("settings.profile", { email, currentPassword });
      setSuccess(true);
      setTimeout(() => {
        onClose();
        window.location.reload();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-fade-up">
      <div className="relative w-full max-w-md rounded-3xl border border-white/15 bg-ink-950/90 p-6 shadow-2xl backdrop-blur-3xl">
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <User size={16} />
            </span>
            <h3 className="text-base font-bold text-white">Change Account Username</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="mt-4 space-y-4">
          <Field label="New Email / Username">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-black/30 border-white/10"
            />
          </Field>

          <Field label="Confirm with Current Password">
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Your current password"
              required
              className="bg-black/30 border-white/10"
            />
          </Field>

          {error && <p className="text-xs text-rose-300">{error}</p>}
          {success && (
            <p className="text-xs text-emerald-400 font-semibold">
              Username updated successfully! Reloading…
            </p>
          )}

          <div className="flex justify-end gap-2.5 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Modal to Change Password */
function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { act } = usePanel();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await act("settings.password", { current, next });
      setSuccess(true);
      setTimeout(() => {
        router.push("/login");
        router.refresh();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-fade-up">
      <div className="relative w-full max-w-md rounded-3xl border border-white/15 bg-ink-950/90 p-6 shadow-2xl backdrop-blur-3xl">
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-500/10 border border-brand-500/20 text-brand-400">
              <Lock size={16} />
            </span>
            <h3 className="text-base font-bold text-white">Change Password</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="mt-4 space-y-4">
          <Field label="Current Password">
            <Input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
              className="bg-black/30 border-white/10"
            />
          </Field>

          <Field label="New Password" hint="Minimum 10 characters. Signs out other sessions.">
            <Input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
              className="bg-black/30 border-white/10"
            />
          </Field>

          {error && <p className="text-xs text-rose-300">{error}</p>}
          {success && (
            <p className="text-xs text-emerald-400 font-semibold">
              Password updated! Signing out…
            </p>
          )}

          <div className="flex justify-end gap-2.5 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Update Password
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Modal to Factory Reset Panel */
function FactoryResetModal({ onClose }: { onClose: () => void }) {
  const { act } = usePanel();
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (confirmText.trim().toUpperCase() !== "RESET") {
      setError("Please type RESET exactly to confirm.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await act("settings.factory_reset", { confirm: "RESET" });
      alert("Panel has been successfully reset to a clean slate.");
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md animate-fade-up">
      <div className="relative w-full max-w-lg rounded-3xl border border-rose-500/30 bg-ink-950/95 p-6 shadow-2xl backdrop-blur-3xl">
        <div className="flex items-center justify-between pb-4 border-b border-rose-500/20">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.3)]">
              <AlertTriangle size={18} />
            </span>
            <div>
              <h3 className="text-base font-bold text-white">Factory Reset Panel</h3>
              <p className="text-xs text-rose-300/80">Permanent, irreversible clean slate</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleReset} className="mt-4 space-y-4">
          <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-xs text-rose-200/90 leading-relaxed space-y-2">
            <p className="font-bold text-rose-100 flex items-center gap-1.5">
              <ShieldAlert size={15} /> All data will be permanently deleted:
            </p>
            <ul className="list-disc list-inside space-y-1 pl-1 text-rose-200/80">
              <li>All deployed applications and containers will be destroyed</li>
              <li>All non-system app databases will be dropped</li>
              <li>All custom domains, cron jobs, and stored backups will be removed</li>
              <li>Server logs, audit trails, and metrics will be purged</li>
            </ul>
          </div>

          <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-200 leading-relaxed">
            ⚠️ <strong>Important Reminder</strong>: If you need any of your data, please download or create backups under <strong>Operations → Backups</strong> before clicking reset!
          </div>

          <Field
            label="Type RESET to confirm"
            hint="To prevent accidental wipes, type the word RESET below:"
          >
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="RESET"
              required
              className="bg-black/30 border-rose-500/30 text-rose-200 font-mono"
            />
          </Field>

          {error && <p className="text-xs text-rose-300 font-medium">{error}</p>}

          <div className="flex justify-end gap-2.5 pt-3 border-t border-white/10">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={confirmText.trim().toUpperCase() !== "RESET" || busy}
              loading={busy}
            >
              <Trash2 size={14} /> Erase All & Reset Panel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
