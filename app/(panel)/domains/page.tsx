"use client";

import { useState } from "react";
import { Globe2, Lock, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shell";
import { Badge, Button, Card, Code, Empty, Field, Input, Modal, Select } from "@/components/ui";
import { usePanel } from "@/lib/client";

export default function DomainsPage() {
  const { state, loading, act } = usePanel();
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState("");
  const [appId, setAppId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await act("domain.add", { host, app: appId });
      setHost("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Domains & SSL"
        subtitle="Point an A record at this server and Traefik issues the certificate automatically."
        action={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus size={14} /> Add domain
          </Button>
        }
      />

      {error && !open && (
        <p className="mb-4 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {loading || !state ? (
        <div className="h-52 animate-pulse rounded-2xl border border-white/5 bg-ink-900/40" />
      ) : state.domains.length === 0 ? (
        <Empty
          title="No domains yet"
          hint="Add the hostname you want to serve. SSL is requested on the first HTTPS hit."
          action={
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus size={14} /> Add your first domain
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          {state.domains.map((d) => (
            <Card key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-brand-400">
                  <Globe2 size={16} />
                </span>
                <div>
                  <p className="text-sm font-medium text-white">{d.host}</p>
                  <p className="text-[11px] text-slate-500">
                    {d.app_name ? (
                      <>
                        routes to <Code>{d.app_name}</Code>
                      </>
                    ) : (
                      "not attached to an app"
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="ok">
                  <ShieldCheck size={11} /> {d.cert}
                </Badge>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void act("domain.remove", { id: d.id })}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {state?.publicIp && (
        <Card className="mt-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
            <Lock size={14} className="text-brand-400" /> DNS setup
          </h2>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
            For every domain above, create an <Code>A</Code> record pointing to{" "}
            <Code>{state.publicIp}</Code>. Wildcard <Code>*.yourdomain.com</Code> works too. Nothing
            else is required — HTTP redirects to HTTPS once the certificate lands.
          </p>
        </Card>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add domain"
        description="The hostname must already resolve to this server."
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Hostname">
            <Input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="app.example.com"
              required
            />
          </Field>
          <Field label="Application">
            <Select value={appId} onChange={(e) => setAppId(e.target.value)} required>
              <option value="">Select an app…</option>
              {state?.apps.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.runtime}
                </option>
              ))}
            </Select>
          </Field>

          {error && (
            <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={busy} disabled={!appId}>
              Attach domain
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
