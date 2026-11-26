"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "./ui";

/**
 * Blue-white aurora backdrop: three soft blobs (blue, cyan, white) plus a
 * faint top wash. Fixed behind the shell so every page shares the same calm
 * glassmorphism lighting. Light mode dims them in globals.css.
 */
export function AuroraBackground({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none fixed inset-0 -z-10 overflow-hidden", className)}
    >
      <div className="aurora aurora-blue absolute -top-60 left-[-12%] h-[640px] w-[640px] rounded-full blur-3xl" />
      <div className="aurora aurora-cyan absolute right-[-14%] top-1/4 h-[560px] w-[560px] rounded-full blur-3xl" />
      <div className="aurora aurora-white absolute -bottom-60 left-1/3 h-[600px] w-[600px] rounded-full blur-3xl" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(217_91%_60%/0.07),transparent_62%)]" />
    </div>
  );
}

type Accent = "blue" | "cyan" | "white";

const ACCENT_CLASS: Record<Accent, string> = {
  blue: "glow-accent-blue",
  cyan: "glow-accent-cyan",
  white: "glow-accent-white",
};

/**
 * Glass card with a blue-white glow, a gentle entrance and a hover lift.
 * Content is unchanged — this is purely a surface.
 */
export function GlassPanel({
  children,
  className,
  accent = "blue",
  interactive = true,
}: {
  children: ReactNode;
  className?: string;
  accent?: Accent;
  interactive?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10, scale: 0.995 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
      whileHover={interactive && !reduce ? { y: -2 } : undefined}
      className={cn("glass-panel", ACCENT_CLASS[accent], className)}
    >
      {children}
    </motion.div>
  );
}

const listVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
};

/** Staggered list container — pair with <GlowItem> for each row/card. */
export function GlowList({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      variants={listVariants}
      initial={reduce ? false : "hidden"}
      animate="show"
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function GlowItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div variants={reduce ? undefined : itemVariants} className={className}>
      {children}
    </motion.div>
  );
}
