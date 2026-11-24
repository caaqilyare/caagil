"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./ui";

export type PaletteItem = { label: string; hint?: string; run: () => void };

/**
 * Minimal Ctrl+K command palette: fuzzy-ish substring filter over a static
 * item list (pages + actions), keyboard navigable, closes on Esc/backdrop.
 */
export function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) || (item.hint ?? "").toLowerCase().includes(q),
    );
  }, [items, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      // Focus after the modal mounts.
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  if (!open) return null;

  function run(item: PaletteItem) {
    onClose();
    item.run();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[index];
      if (item) run(item);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Quick find"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-ink-900 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Jump to a page… (Ctrl+K)"
          className="w-full border-b border-white/10 bg-transparent px-4 py-3.5 text-sm text-white outline-none placeholder:text-slate-500"
        />
        <div className="max-h-72 overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-slate-500">No matches.</p>
          )}
          {filtered.map((item, i) => (
            <button
              key={`${item.label}-${i}`}
              onClick={() => run(item)}
              onMouseEnter={() => setIndex(i)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition",
                i === index ? "bg-white/[0.08] text-white" : "text-slate-300",
              )}
            >
              <span className="truncate">{item.label}</span>
              {item.hint && (
                <span className="ml-auto shrink-0 text-[11px] text-slate-500">{item.hint}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-white/10 px-4 py-2 text-[11px] text-slate-500">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
