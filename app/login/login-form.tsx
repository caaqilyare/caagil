"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Terminal } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { ThemeToggle } from "@/components/theme";

export function LoginForm() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Login failed");
      router.push("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      <div className="pointer-events-none absolute inset-0 grid-lines opacity-40" />
      <div className="pointer-events-none absolute -top-40 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-brand-500/15 blur-[120px]" />

      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>

      <div className="animate-fade-up relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-glow">
            <Terminal size={22} className="text-ink-950" strokeWidth={2.6} />
          </span>
          <h1 className="text-xl font-semibold tracking-tight text-white">
            {process.env.NEXT_PUBLIC_PANEL_NAME || "Caaqil"}
          </h1>
          <p className="mt-1 text-sm text-slate-400">Sign in to your hosting panel</p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-5">
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Username or email
            </label>
            <Input
              type="text"
              autoComplete="username"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="admin or you@example.com"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Password
            </label>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••"
              required
            />
          </div>

          {error && (
            <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" loading={loading}>
            {loading ? <Loader2 className="animate-spin" size={15} /> : null}
            Sign in
          </Button>
        </form>

        <p className="mt-4 text-center text-[11px] leading-relaxed text-slate-500">
          Sessions are stored on the server and expire after 14 days.
        </p>
      </div>
    </div>
  );
}
