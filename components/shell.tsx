"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Boxes,
  Database,
  Globe2,
  LayoutDashboard,
  LogOut,
  Settings,
  Sparkles,
  Terminal,
} from "lucide-react";
import { cn } from "./ui";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/apps", label: "Applications", icon: Boxes },
  { href: "/databases", label: "Databases", icon: Database },
  { href: "/domains", label: "Domains & SSL", icon: Globe2 },
  { href: "/assistant", label: "AI Operator", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Shell({
  user,
  panelName,
  children,
}: {
  user: { email: string; role: string };
  panelName: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-white/5 bg-ink-900/40 px-3 py-4 backdrop-blur-xl lg:flex">
        <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 shadow-glow">
            <Terminal size={17} className="text-ink-950" strokeWidth={2.6} />
          </span>
          <span>
            <span className="block text-sm font-semibold tracking-tight text-white">{panelName}</span>
            <span className="block text-[10px] uppercase tracking-[0.16em] text-slate-500">
              hosting panel
            </span>
          </span>
        </Link>

        <nav className="flex-1 space-y-0.5">
          {NAV.map((item) => {
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition",
                  active
                    ? "bg-white/[0.07] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.06)]"
                    : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
                )}
              >
                <item.icon
                  size={16}
                  className={cn(active ? "text-brand-400" : "text-slate-500 group-hover:text-slate-300")}
                />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 rounded-xl border border-white/5 bg-ink-950/50 p-3">
          <p className="truncate text-xs font-medium text-slate-300">{user.email}</p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-500">{user.role}</p>
          <button
            onClick={logout}
            className="mt-2.5 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-white/5 bg-ink-950/70 px-4 py-3 backdrop-blur-xl lg:hidden">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500">
              <Terminal size={15} className="text-ink-950" />
            </span>
            <span className="text-sm font-semibold text-white">{panelName}</span>
          </Link>
          <nav className="flex gap-1 overflow-x-auto">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-lg p-2",
                  pathname === item.href ? "bg-white/10 text-brand-400" : "text-slate-400",
                )}
                aria-label={item.label}
              >
                <item.icon size={16} />
              </Link>
            ))}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-9">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
