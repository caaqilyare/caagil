"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Globe, KeyRound, Lock, Save, Server, ShieldCheck, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/shell";
import { Badge, Button, Card, Code, Field, Input, Select } from "@/components/ui";
import { SslBadge, SslFixModal, useSslStatus } from "@/components/ssl";
import { usePanel } from "@/lib/client";

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
    <>
      <PageHeader title="Settings" subtitle="Panel identity, public address and the AI provider." />

      <form onSubmit={save} className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Server size={14} className="text-brand-400" /> Panel
          </h2>

          <Field label="Panel name">
            <Input value={panelName} onChange={(e) => setPanelName(e.target.value)} placeholder="Caaqil" />
          </Field>

          <Field
            label="Panel domain"
            hint="Served over HTTPS with an automatic certificate. Point DNS at this server before changing it."
          >
            <div className="flex gap-2">
              <Input
                value={panelDomain}
                onChange={(e) => setPanelDomain(e.target.value)}
                placeholder="panel.example.com"
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
                  <ShieldCheck size={13} /> Add SSL
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
              hint="Used for database connection strings and the optional IP route."
            >
              <Input value={publicIp} onChange={(e) => setPublicIp(e.target.value)} placeholder="203.0.113.10" />
            </Field>
            <Field label="IP access" hint="Reach the panel at http://IP when DNS is not ready yet.">
              <label className="flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-ink-900/70 px-3 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={allowIp}
                  onChange={(e) => setAllowIp(e.target.checked)}
                  className="h-3.5 w-3.5 accent-brand-500"
                />
                Allow plain HTTP by IP
              </label>
            </Field>
          </div>

          {allowIp && (
            <p className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] leading-relaxed text-amber-200">
              Plain HTTP sends your password unencrypted. Use IP access to bootstrap or recover, and turn
              it off once HTTPS works.
            </p>
          )}

          {accessUrl && (
            <p className="rounded-lg border border-brand-500/25 bg-brand-500/10 px-3 py-2 text-[11px] leading-relaxed text-brand-200">
              <Globe size={11} className="mr-1 inline" /> Panel now served at{" "}
              <a href={accessUrl} className="font-medium underline">
                {accessUrl}
              </a>{" "}
              — open that address to continue.
            </p>
          )}

          {state && (
            <div className="space-y-1.5 rounded-xl border border-white/5 bg-ink-950/50 p-3 text-[11px] text-slate-400">
              <p>
                Platform <Code>{state.stats.platform}</Code>
              </p>
              <p>
                Panel URL <Code>{state.panel.url || "not set"}</Code>
              </p>
              <p>
                Docker{" "}
                {state.stats.docker.ok ? (
                  <Badge tone="ok">connected · {state.stats.docker.version}</Badge>
                ) : (
                  <Badge tone="bad">offline</Badge>
                )}
              </p>
            </div>
          )}
        </Card>

        <Card className="space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Sparkles size={14} className="text-brand-400" /> AI operator
          </h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Provider">
              <Select
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  const meta = state?.providers.find((p) => p.id === e.target.value);
                  if (meta) setModel(meta.models[0]);
                }}
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
                <Select value={model} onChange={(e) => setModel(e.target.value)}>
                  {providerMeta.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input value={model} onChange={(e) => setModel(e.target.value)} />
              )}
            </Field>
          </div>

          <Field
            label={`${providerMeta?.label ?? provider} API key`}
            hint="Stored in your MySQL database. Leave empty to keep the current key or fall back to the environment variable."
          >
            <Input
              type="password"
              value={keys[provider] ?? ""}
              onChange={(e) => setKeys((k) => ({ ...k, [provider]: e.target.value }))}
              placeholder="sk-…"
              autoComplete="off"
            />
          </Field>

          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-500">
            <KeyRound size={12} className="mt-0.5 shrink-0" />
            The agent runs server-side only. Keys never reach the browser after saving.
          </p>
        </Card>

        <div className="flex items-center gap-3 lg:col-span-2">
          <Button type="submit" loading={busy}>
            <Save size={14} /> Save settings
          </Button>
          {saved && (
            <span className="flex items-center gap-1 text-xs text-brand-400">
              <Check size={13} /> Saved
            </span>
          )}
          {error && <span className="text-xs text-red-300">{error}</span>}
        </div>
      </form>

      <ChangePassword />

      {sslFor && (
        <SslFixModal
          domain={sslFor}
          onClose={() => {
            setSslFor(null);
            void sslRefresh();
          }}
        />
      )}
    </>
  );
}

function ChangePassword() {
  const router = useRouter();
  const { act } = usePanel();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await act("settings.password", { current, next });
      setMessage("Password changed — signing you out…");
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
    <form onSubmit={submit} className="mt-4 max-w-xl">
      <Card className="space-y-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <Lock size={14} className="text-brand-400" /> Change password
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Current password">
            <Input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <Field label="New password" hint="At least 10 characters. All other sessions are signed out.">
            <Input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              minLength={10}
              required
            />
          </Field>
        </div>
        {message && <p className="text-xs text-brand-400">{message}</p>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        <Button type="submit" size="sm" loading={busy}>
          Update password
        </Button>
      </Card>
    </form>
  );
}
