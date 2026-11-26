"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Terminal } from "lucide-react";
import { Button, Input } from "@/components/ui";
import { ThemeToggle } from "@/components/theme";

export function LoginForm() {
  const router = useRouter();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[radial-gradient(ellipse_at_top_left,#4cbdff_0%,#0049e8_45%,#03045e_100%)]">
      {/* Subtle decorative grid & accent glow */}
      <div className="pointer-events-none absolute inset-0 grid-lines opacity-20" />
      <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-[#ab13c5]/25 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-80 w-80 rounded-full bg-[#4cbdff]/25 blur-[100px]" />

      {/* Transparent topbar */}
      <header className="relative z-10 flex h-[68px] items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#0049e8] shadow-sm">
            <Terminal size={18} strokeWidth={2.5} />
          </span>
          <div>
            <p className="text-base font-bold leading-tight text-white">
              {process.env.NEXT_PUBLIC_PANEL_NAME || "Caaqil"}
            </p>
            <p className="text-[11px] leading-tight text-white/75">Cloud Control Panel</p>
          </div>
        </div>
        <ThemeToggle />
      </header>

      {/* Centered AdminUX login card */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-8">
        <div className="animate-fade-up w-full max-w-[426px]">
          <div className="rounded-[1.5rem] bg-card p-7 text-card-foreground shadow-[0_24px_60px_rgba(0,0,0,0.28)] sm:p-8">
            <div className="mb-6">
              <h2 className="text-2xl font-semibold tracking-tight text-primary">Login</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Welcome back — sign in to your hosting panel
              </p>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Username or email
                </label>
                <Input
                  type="text"
                  autoComplete="username"
                  value={login}
                  onChange={(e) => setLogin(e.target.value)}
                  placeholder="admin or you@example.com"
                  className="h-11"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Password</label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••"
                    className="h-11 pr-11"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-primary transition hover:bg-primary/10"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {error && (
                <p className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" size="lg" className="mt-2 w-full" loading={loading}>
                {loading ? <Loader2 className="animate-spin" size={16} /> : null}
                Login
              </Button>
            </form>
          </div>
        </div>
      </main>

      {/* Solid #0049e8 footer bar */}
      <footer className="relative z-10 bg-[#0049e8] py-3 text-center text-xs text-white/85">
        Sessions are stored on the server and expire after 14 days.
      </footer>
    </div>
  );
}
