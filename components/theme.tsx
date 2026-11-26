"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Monitor, Moon, Sun } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "./ui";

export type Theme = "light" | "dark" | "system";
type Resolved = "light" | "dark";

type ThemeContextValue = {
  theme: Theme;
  resolved: Resolved;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
};

const STORAGE_KEY = "caaqil-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): Resolved {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(resolved: Resolved) {
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
  root.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [resolved, setResolved] = useState<Resolved>("dark");
  const themeRef = useRef<Theme>("system");

  // Read the stored preference after hydration. The blocking script in
  // app/layout.tsx already applied the right class, so this only syncs state.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* private mode */
    }
    const initial: Theme =
      stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    themeRef.current = initial;
    setThemeState(initial);
    const next = initial === "system" ? systemTheme() : initial;
    setResolved(next);
    applyTheme(next);
  }, []);

  // Follow the OS while the user chose "system".
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (themeRef.current !== "system") return;
      const next = systemTheme();
      setResolved(next);
      applyTheme(next);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    themeRef.current = next;
    setThemeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode */
    }
    const value = next === "system" ? systemTheme() : next;
    setResolved(value);
    applyTheme(value);
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolved === "dark" ? "light" : "dark");
  }, [resolved, setTheme]);

  const value = useMemo(
    () => ({ theme, resolved, setTheme, toggle }),
    [theme, resolved, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}

/** Icon-only light/dark switch with a soft icon rotation. */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolved, toggle } = useTheme();
  const label = resolved === "dark" ? "Switch to light mode" : "Switch to dark mode";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={cn(
        "relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card/60 text-muted-foreground backdrop-blur transition-colors hover:border-primary/30 hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={resolved}
          initial={{ opacity: 0, rotate: -70, scale: 0.6 }}
          animate={{ opacity: 1, rotate: 0, scale: 1 }}
          exit={{ opacity: 0, rotate: 70, scale: 0.6 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="flex"
        >
          {resolved === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

/** Three-way picker (light / dark / system) for Settings. */
export function ThemePicker() {
  const { theme, setTheme } = useTheme();
  const options: { id: Theme; label: string; icon: typeof Sun }[] = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "System", icon: Monitor },
  ];

  return (
    <div className="inline-flex rounded-xl border border-border bg-muted/60 p-1">
      {options.map((option) => {
        const active = theme === option.id;
        return (
          <button
            key={option.id}
            type="button"
            onClick={() => setTheme(option.id)}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
              active ? "text-accent-foreground" : "text-muted-foreground hover:text-foreground",
            )}
            aria-pressed={active}
          >
            {active && (
              <motion.span
                layoutId="theme-picker-active"
                className="absolute inset-0 rounded-lg border border-primary/20 bg-card shadow-sm"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            )}
            <option.icon size={13} className="relative z-10" />
            <span className="relative z-10">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
