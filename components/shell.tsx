"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Archive,
  Boxes,
  Clock,
  Database,
  FileText,
  Globe2,
  LayoutDashboard,
  LogOut,
  Menu,
  Search,
  Settings,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { cn, Kbd } from "./ui";
import { CommandPalette } from "./command-palette";
import { ThemeToggle } from "./theme";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
};
type NavGroup = { group: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    group: "Overview",
    items: [{ href: "/", label: "Overview", icon: LayoutDashboard }],
  },
  {
    group: "Hosting",
    items: [
      { href: "/apps", label: "Applications", icon: Boxes },
      { href: "/domains", label: "Domains & SSL", icon: Globe2 },
    ],
  },
  {
    group: "Databases",
    items: [{ href: "/databases", label: "Databases", icon: Database }],
  },
  {
    group: "Operations",
    items: [
      { href: "/cron", label: "Cron Jobs", icon: Clock },
      { href: "/backups", label: "Backups", icon: Archive },
      { href: "/logs", label: "Logs", icon: FileText },
    ],
  },
  {
    group: "System",
    items: [
      { href: "/assistant", label: "AI Operator", icon: Sparkles },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

const NAV = NAV_GROUPS.flatMap((group) => group.items);

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function pageTitle(pathname: string) {
  const hit = [...NAV]
    .sort((a, b) => b.href.length - a.href.length)
    .find((item) => isActive(pathname, item.href));
  return hit?.label ?? "Overview";
}

function Brand({ panelName, onNavigate }: { panelName: string; onNavigate?: () => void }) {
  return (
    <Link href="/" onClick={onNavigate} className="flex min-w-0 items-center gap-2.5">
      <span className="glow-soft flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 via-emerald-400 to-teal-500">
        <Terminal size={17} className="text-ink-950" strokeWidth={2.6} />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold tracking-tight text-foreground">
          {panelName}
        </span>
        <span className="block font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          cloud panel
        </span>
      </span>
    </Link>
  );
}

function NavList({
  pathname,
  layoutId,
  updateReady,
  onNavigate,
  onQuickFind,
}: {
  pathname: string;
  layoutId: string;
  updateReady: boolean;
  onNavigate?: () => void;
  onQuickFind: () => void;
}) {
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-3">
      {NAV_GROUPS.map((group) => (
        <div key={group.group}>
          <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
            {group.group}
          </p>
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors",
                    active
                      ? "font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId={layoutId}
                      className="absolute inset-0 rounded-xl border border-primary/20 bg-accent"
                      transition={{ type: "spring", stiffness: 420, damping: 34 }}
                    />
                  )}
                  <item.icon size={16} className="relative z-10 shrink-0" />
                  <span className="relative z-10 truncate">{item.label}</span>
                  {item.href === "/settings" && updateReady && (
                    <span
                      className="relative z-10 ml-auto flex h-1.5 w-1.5"
                      title="Panel update available"
                    >
                      <span className="absolute h-1.5 w-1.5 animate-ping rounded-full bg-amber-400 opacity-75" />
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => {
          onQuickFind();
          onNavigate?.();
        }}
        className="flex w-full items-center gap-2.5 rounded-xl border border-border/60 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Search size={16} className="shrink-0" />
        Quick find
        <Kbd className="ml-auto">Ctrl K</Kbd>
      </button>
    </nav>
  );
}

function UserCard({
  user,
  onLogout,
}: {
  user: { email: string; role: string };
  onLogout: () => void;
}) {
  const initial = (user.email || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="rounded-xl border border-sidebar-border bg-card/50 p-2.5">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-primary/20 bg-primary/10 text-xs font-semibold text-primary">
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground">{user.email}</p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {user.role}
          </p>
        </div>
        <button
          type="button"
          onClick={onLogout}
          aria-label="Sign out"
          title="Sign out"
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <LogOut size={14} />
        </button>
      </div>
    </div>
  );
}

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
  const reduceMotion = useReducedMotion();
  const [updateReady, setUpdateReady] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Ctrl/Cmd+K opens the command palette.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // A quiet dot next to Settings when GitHub main is ahead. The Settings page
  // owns the full update UI; this is only a hint.
  useEffect(() => {
    let alive = true;
    async function check() {
      try {
        const res = await fetch("/api/update", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { available?: boolean; running?: boolean };
        if (alive) setUpdateReady(Boolean(data.available || data.running));
      } catch {
        // Offline or the panel is restarting mid-update.
      }
    }
    void check();
    const id = setInterval(check, 10 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const navItems = useMemo(() => NAV, []);
  const title = pageTitle(pathname);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const paletteItems = useMemo(
    () =>
      navItems.map((item) => ({
        label: item.label,
        hint: item.href,
        run: () => router.push(item.href),
      })),
    [navItems, router],
  );

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      {/* Ambient light — soft, low opacity, calmer in light mode (see globals). */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="ambient absolute -top-48 left-[-12%] h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle_at_center,hsl(var(--primary)/0.22),transparent_65%)] blur-3xl" />
        <div className="ambient absolute right-[-15%] top-1/3 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.16),transparent_65%)] blur-3xl" />
        <div className="ambient absolute -bottom-48 left-1/3 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.12),transparent_65%)] blur-3xl" />
      </div>

      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar/80 backdrop-blur-xl lg:flex">
          <div className="flex h-16 items-center px-5">
            <Brand panelName={panelName} />
          </div>
          <NavList
            pathname={pathname}
            layoutId="sidebar-active"
            updateReady={updateReady}
            onQuickFind={() => setPaletteOpen(true)}
          />
          <div className="border-t border-sidebar-border p-3">
            <UserCard user={user} onLogout={logout} />
          </div>
        </aside>

        {/* Mobile drawer */}
        <AnimatePresence>
          {mobileOpen && (
            <>
              <motion.div
                key="drawer-scrim"
                className="fixed inset-0 z-50 bg-overlay/50 backdrop-blur-sm lg:hidden"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => setMobileOpen(false)}
              />
              <motion.aside
                key="drawer"
                className="fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-sidebar-border bg-sidebar lg:hidden"
                initial={{ x: -300 }}
                animate={{ x: 0 }}
                exit={{ x: -300 }}
                transition={{ type: "spring", stiffness: 380, damping: 36 }}
              >
                <div className="flex h-16 items-center justify-between px-4">
                  <Brand panelName={panelName} onNavigate={() => setMobileOpen(false)} />
                  <button
                    type="button"
                    onClick={() => setMobileOpen(false)}
                    aria-label="Close menu"
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <X size={17} />
                  </button>
                </div>
                <NavList
                  pathname={pathname}
                  layoutId="sidebar-active-mobile"
                  updateReady={updateReady}
                  onNavigate={() => setMobileOpen(false)}
                  onQuickFind={() => setPaletteOpen(true)}
                />
                <div className="border-t border-sidebar-border p-3">
                  <UserCard user={user} onLogout={logout} />
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          items={paletteItems}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar */}
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/75 px-4 backdrop-blur-xl sm:px-6">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card/60 text-muted-foreground hover:bg-accent hover:text-accent-foreground lg:hidden"
            >
              <Menu size={17} />
            </button>

            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                {panelName}
              </p>
              <h1 className="truncate text-sm font-semibold tracking-tight text-foreground">
                {title}
              </h1>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="hidden h-9 items-center gap-2 rounded-xl border border-border bg-card/60 px-3 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:inline-flex"
              >
                <Search size={14} />
                Quick find
                <Kbd>Ctrl K</Kbd>
              </button>
              <ThemeToggle />
              <Link
                href="/settings"
                aria-label="Settings"
                title="Settings"
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card/60 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              >
                <Settings size={16} />
                {updateReady && (
                  <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-background" />
                )}
              </Link>
              <button
                type="button"
                onClick={logout}
                aria-label="Sign out"
                title="Sign out"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card/60 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <LogOut size={16} />
              </button>
            </div>
          </header>

          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={pathname}
                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              >
                {children}
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
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
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
