"use client";

import { clsx, type ClassValue } from "clsx";
import { cva, type VariantProps } from "class-variance-authority";
import { twMerge } from "tailwind-merge";
import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { X } from "lucide-react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ───────────────────────────── buttons ───────────────────────────── */

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:scale-[.985]",
  {
    variants: {
      variant: {
        primary:
          "bg-[#0049e8] text-white shadow-[0_8px_24px_-10px_rgba(0,73,232,0.55)] hover:bg-[#003fc7] active:bg-[#0037ad]",
        accent:
          "bg-[#03045e] text-white shadow-sm hover:bg-[#01024b] active:bg-[#010235]",
        secondary:
          "border border-border bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "bg-transparent text-muted-foreground hover:bg-primary/10 hover:text-primary",
        subtle:
          "bg-primary/12 text-primary hover:bg-primary/20",
        danger:
          "border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20",
        success:
          "bg-[#6faa00] text-white shadow-sm hover:bg-[#5e9100]",
        outline:
          "border border-primary/75 bg-transparent text-primary hover:bg-primary/85 hover:text-white",
        dashed:
          "border border-dashed border-primary/70 bg-transparent text-primary hover:bg-primary/10",
      },
      size: {
        sm: "h-8 rounded-lg px-3 text-xs",
        md: "h-[38px] px-4 text-sm",
        lg: "h-12 rounded-3xl px-5 text-base",
        icon: "h-[38px] w-[38px] p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    loading?: boolean;
  };

export function Button({
  variant,
  size,
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
      className={cn(buttonVariants({ variant, size }), className)}
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
  "w-full rounded-xl border border-input bg-background/60 px-3 text-sm text-foreground placeholder:text-muted-foreground/70 outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50";

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
      className={cn(fieldBase, "h-10 appearance-none bg-card pr-8", props.className)}
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
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[11px] leading-relaxed text-muted-foreground/80">{hint}</span>}
    </label>
  );
}

/* ─────────────────────────────── misc ───────────────────────────── */

export function Card({
  className,
  children,
  hover,
}: {
  className?: string;
  children: ReactNode;
  hover?: boolean;
}) {
  return (
    <div
      className={cn(
        "card p-5",
        hover && "glass-card-hover cursor-pointer",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ListGroup({
  variant = "default",
  className,
  children,
}: {
  variant?: "default" | "minimal";
  className?: string;
  children: ReactNode;
}) {
  return (
    <ul
      className={cn(
        "rounded-[var(--radius)]",
        variant === "default"
          ? "divide-y divide-border overflow-hidden border border-border bg-card"
          : "space-y-1 bg-transparent",
        className,
      )}
    >
      {children}
    </ul>
  );
}

export function ListItem({
  active,
  interactive = true,
  className,
  children,
  onClick,
}: {
  active?: boolean;
  interactive?: boolean;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <li
      onClick={onClick}
      className={cn(
        "flex items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors",
        interactive && "cursor-pointer",
        active
          ? "bg-primary text-primary-foreground font-medium"
          : interactive && "hover:bg-primary/10 hover:text-foreground",
        className,
      )}
    >
      {children}
    </li>
  );
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
    neutral: "border-border bg-muted/70 text-muted-foreground",
    ok: "border-primary/25 bg-primary/10 text-primary",
    warn: "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300",
    bad: "border-destructive/25 bg-destructive/10 text-destructive",
    info: "border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-300",
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
        ok
          ? "bg-primary shadow-[0_0_8px_hsl(var(--glow)/.7)]"
          : "bg-destructive shadow-[0_0_8px_hsl(var(--destructive)/.6)]",
      )}
    />
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "rounded-md border border-border bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export function Meter({ value, tone = "brand" }: { value: number; tone?: "brand" | "amber" | "red" }) {
  const colors = {
    brand: "from-primary to-primary/60",
    amber: "from-amber-500 to-amber-400",
    red: "from-destructive to-destructive/60",
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
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
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay/50 p-4 backdrop-blur-sm sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onMouseDown={(event) => event.stopPropagation()}
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "w-full rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-2xl",
              wide ? "max-w-3xl" : "max-w-lg",
            )}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">{title}</h2>
                {description && (
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
                )}
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="space-y-4">{children}</div>
            {footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="grid-lines flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border px-6 py-14 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md border border-border bg-muted/70 px-1.5 py-0.5 font-mono text-[11px] text-primary">
      {children}
    </code>
  );
}
