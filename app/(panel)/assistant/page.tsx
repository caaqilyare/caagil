"use client";

import { useChat } from "@ai-sdk/react";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, Sparkles, Square, User, Wrench } from "lucide-react";
import { PageHeader } from "@/components/shell";
import { Badge, Button, Card, cn } from "@/components/ui";
import type { PanelState } from "@/lib/client";

const SUGGESTIONS = [
  "What is running on this server right now?",
  "Create a PHP 8.4 app called portfolio from https://github.com/me/portfolio",
  "Create a MySQL database named shop and tell me the env vars",
  "Expose the shop database publicly and show me the connection string",
  "Add caaqil.vps.webdock.cloud as a domain for portfolio",
];

export default function AssistantPage() {
  const { messages, sendMessage, status, error, stop } = useChat();
  const [input, setInput] = useState("");
  const [meta, setMeta] = useState<PanelState["ai"] | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/state", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setMeta(s.ai))
      .catch(() => {});
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const busy = status === "streaming" || status === "submitted";

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    sendMessage({ text: input.trim() });
    setInput("");
  }

  return (
    <>
      <PageHeader
        title="AI Operator"
        subtitle="An agent that deploys apps, creates databases and edits routing through the panel tools."
        action={
          meta ? (
            <Badge tone={meta.hasKey ? "ok" : "warn"}>
              <Sparkles size={11} /> {meta.label} · {meta.model}
              {!meta.hasKey && " · no key"}
            </Badge>
          ) : null
        }
      />

      <Card className="flex h-[calc(100vh-14rem)] min-h-[420px] flex-col p-0">
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400/20 to-brand-600/10 text-brand-400 ring-1 ring-brand-500/25">
                <Bot size={22} />
              </span>
              <div>
                <p className="text-sm font-medium text-white">Ask for anything on this server</p>
                <p className="mt-1 text-xs text-slate-500">
                  The agent sees live state and can act — with confirmation before destructive steps.
                </p>
              </div>
              <div className="flex max-w-lg flex-wrap justify-center gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => sendMessage({ text: s })}
                    className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] text-slate-300 transition hover:border-brand-500/30 hover:text-white"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={cn("flex gap-2.5", m.role === "user" ? "justify-end" : "justify-start")}
              >
                {m.role !== "user" && (
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400">
                    <Bot size={14} />
                  </span>
                )}
                <div
                  className={cn(
                    "max-w-[85%] space-y-2 rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    m.role === "user"
                      ? "bg-brand-500 text-ink-950"
                      : "border border-white/5 bg-ink-950/60 text-slate-200",
                  )}
                >
                  {m.parts.map((part, i) => {
                    if (part.type === "text") {
                      return (
                        <p key={i} className="whitespace-pre-wrap">
                          {part.text}
                        </p>
                      );
                    }
                    if (part.type === "dynamic-tool" || part.type.startsWith("tool-")) {
                      const name =
                        "toolName" in part ? part.toolName : part.type.replace(/^tool-/, "");
                      const state = "state" in part ? part.state : "";
                      return (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10px] text-slate-400"
                        >
                          <Wrench size={10} />
                          {name}
                          {state ? ` · ${state}` : ""}
                        </span>
                      );
                    }
                    return null;
                  })}
                </div>
                {m.role === "user" && (
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-slate-300">
                    <User size={14} />
                  </span>
                )}
              </div>
            ))
          )}
          {busy && (
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-brand-400" />
              working…
            </p>
          )}
          {error && (
            <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error.message}
            </p>
          )}
          <div ref={endRef} />
        </div>

        <form onSubmit={submit} className="border-t border-white/5 p-3">
          <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-ink-950/70 p-2 focus-within:border-brand-500/40">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(e);
                }
              }}
              rows={1}
              placeholder="Deploy a Laravel app, check disk usage, expose a database…"
              className="max-h-32 min-h-[38px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none"
            />
            {busy ? (
              <Button type="button" size="sm" variant="danger" onClick={() => stop()}>
                <Square size={12} /> Stop
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={!input.trim()}>
                <ArrowUp size={14} /> Send
              </Button>
            )}
          </div>
        </form>
      </Card>
    </>
  );
}
