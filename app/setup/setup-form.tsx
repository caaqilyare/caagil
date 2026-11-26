"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles, Terminal } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { ThemeToggle } from "@/components/theme";

export function SetupForm() {
  const router = useRouter();
  const [panelName, setPanelName] = useState("Caaqil");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password, panelName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Setup failed");
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0 grid-lines opacity-40" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-brand-500/15 blur-[120px]" />

      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="animate-fade-up relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-glow">
            <Terminal size={22} className="text-ink-950" strokeWidth={2.6} />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-white">Welcome to Caaqil</h1>
          <p className="mt-1 text-sm text-slate-400">
            Create the owner account. You can add a domain later in Settings.
          </p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-5">
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Panel name
            </label>
            <Input
              value={panelName}
              onChange={(e) => setPanelName(e.target.value)}
              placeholder="Caaqil"
              maxLength={40}
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Username or email
            </label>
            <Input
              autoComplete="username"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="admin"
              required
            />
            <p className="text-[11px] text-slate-500">This is what you will use to sign in.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Password
              </label>
              <Input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 10 characters"
                minLength={10}
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Confirm
              </label>
              <Input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat password"
                minLength={10}
                required
              />
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" loading={loading}>
            {loading ? <Loader2 className="animate-spin" size={15} /> : <Sparkles size={15} />}
            Create owner account
          </Button>
        </form>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-500">
          The panel starts on <code className="text-slate-400">http://your-server-ip</code>. Add a
          domain later under Settings → Panel domain for automatic HTTPS.
        </p>
      </div>
    </div>
  );
}
