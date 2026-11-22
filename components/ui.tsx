"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import { X } from "lucide-react";

export const cn = clsx;

/* ───────────────────────────── buttons ───────────────────────────── */

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "subtle" | "danger";
  size?: "sm" | "md";
  loading?: boolean;
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
        variant === "primary" &&
          "bg-brand-500 text-ink-950 shadow-glow hover:bg-brand-400 active:scale-[.985]",
        variant === "ghost" && "border border-white/10 text-slate-300 hover:bg-white/5",
        variant === "subtle" && "bg-white/5 text-slate-200 hover:bg-white/10",
        variant === "danger" && "border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20",
        className,
      )}
    >
      {loading && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}

/* ────────────────────────────── inputs ──────────────────────────── */

const fieldBase =
  "w-full rounded-xl border border-white/10 bg-ink-950/60 px-3 text-sm text-slate-100 placeholder:text-slate-500 outline-none transition focus:border-brand-500/60 focus:ring-2 focus:ring-brand-500/15";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldBase, "h-10", props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(fieldBase, "min-h-[84px] py-2.5", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(fieldBase, "h-10 appearance-none bg-ink-900 pr-8", props.className)}
    />
  );
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block space-y-1.5", className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] leading-relaxed text-slate-500">{hint}</span>}
    </label>
  );
}

/* ─────────────────────────────── misc ───────────────────────────── */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("card p-5", className)}>{children}</div>;
}

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "ok" | "warn" | "bad" | "info";
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: "bg-white/5 text-slate-300 border-white/10",
    ok: "bg-brand-500/10 text-brand-400 border-brand-500/25",
    warn: "bg-amber-500/10 text-amber-300 border-amber-500/25",
    bad: "bg-red-500/10 text-red-300 border-red-500/25",
    info: "bg-sky-500/10 text-sky-300 border-sky-500/25",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 rounded-full",
        ok ? "bg-brand-400 shadow-[0_0_8px_rgba(52,224,161,.8)]" : "bg-red-400",
      )}
    />
  );
}

export function Meter({ value, tone = "brand" }: { value: number; tone?: "brand" | "amber" | "red" }) {
  const colors = {
    brand: "from-brand-500 to-brand-400",
    amber: "from-amber-500 to-amber-400",
    red: "from-red-500 to-red-400",
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/5">
      <div
        className={cn("h-full rounded-full bg-gradient-to-r transition-all", colors[tone])}
        style={{ width: `${Math.min(100, Math.max(2, value))}%` }}
      />
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/80 p-4 backdrop-blur-sm sm:items-center">
      <div
        className={cn(
          "animate-fade-up w-full rounded-2xl border border-white/10 bg-ink-900 p-5 shadow-2xl",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-white">{title}</h2>
            {description && <p className="mt-1 text-xs text-slate-400">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="space-y-4">{children}</div>
        {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="grid-lines flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 px-6 py-14 text-center">
      <p className="text-sm font-medium text-slate-300">{title}</p>
      {hint && <p className="max-w-sm text-xs text-slate-500">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md bg-ink-950/80 px-1.5 py-0.5 font-mono text-[11px] text-brand-400">
      {children}
    </code>
  );
}
