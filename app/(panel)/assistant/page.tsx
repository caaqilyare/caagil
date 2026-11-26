"use client";

import { useChat } from "@ai-sdk/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  BookOpen,
  Bot,
  Brain,
  MessageSquare,
  Plus,
  Sparkles,
  Square,
  Trash2,
  User,
  Wrench,
} from "lucide-react";
import { PageHeader } from "@/components/shell";
import { Badge, Button, Card, Input, Modal, Textarea, cn } from "@/components/ui";
import type { PanelState } from "@/lib/client";

type ThreadRow = { id: string; title: string; created_at: number; updated_at: number };
type MemoryRow = { id: string; content: string; category: string; created_at: number };

const SUGGESTIONS = [
  "What is running on this server right now?",
  "Inspect my app files and design a modern landing page inside it",
  "Remember that I prefer Tailwind CSS and blue/white AdminUX styling",
  "Create a PHP 8.4 app called portfolio and set up its index page",
  "Create a MySQL database named shop and tell me the env vars",
];

function newThreadId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID().slice(0, 16)
    : `t-${Date.now().toString(36)}`;
}

export default function AssistantPage() {
  const [threadId, setThreadId] = useState<string>(() => newThreadId());
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [customRules, setCustomRules] = useState("");
  const [sidebarTab, setSidebarTab] = useState<"history" | "memory">("history");
  const [rulesModalOpen, setRulesModalOpen] = useState(false);
  const [rulesDraft, setRulesDraft] = useState("");
  const [savingRules, setSavingRules] = useState(false);
  const [newMemText, setNewMemText] = useState("");

  const { messages, setMessages, sendMessage, status, error, stop } = useChat({
    id: threadId,
  });

  const [input, setInput] = useState("");
  const [meta, setMeta] = useState<PanelState["ai"] | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const loadThreads = useCallback(async () => {
    const res = await fetch("/api/chat/history", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { threads: ThreadRow[] };
      setThreads(data.threads ?? []);
    }
  }, []);

  const loadMemories = useCallback(async () => {
    const res = await fetch("/api/chat/memory", { cache: "no-store" });
    if (res.ok) {
      const data = (await res.json()) as { memories: MemoryRow[]; rules: string };
      setMemories(data.memories ?? []);
      setCustomRules(data.rules ?? "");
      setRulesDraft(data.rules ?? "");
    }
  }, []);

  useEffect(() => {
    fetch("/api/state", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => s && setMeta(s.ai))
      .catch(() => {});
    void loadThreads();
    void loadMemories();
  }, [loadThreads, loadMemories]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, status]);

  const busy = status === "streaming" || status === "submitted";

  // Refresh history & memories after a response finishes
  const prevBusy = useRef(false);
  useEffect(() => {
    if (prevBusy.current && !busy) {
      void loadThreads();
      void loadMemories();
    }
    prevBusy.current = busy;
  }, [busy, loadThreads, loadMemories]);

  function startNewChat() {
    setThreadId(newThreadId());
    setMessages([]);
  }

  async function openThread(id: string) {
    const res = await fetch(`/api/chat/history?thread=${encodeURIComponent(id)}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      messages: { id: number; role: "user" | "assistant"; content: string }[];
    };
    setThreadId(id);
    setMessages(
      (data.messages ?? []).map((m) => ({
        id: String(m.id),
        role: m.role,
        parts: [{ type: "text", text: m.content }],
      })),
    );
  }

  async function removeThread(id: string) {
    await fetch(`/api/chat/history?thread=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (id === threadId) startNewChat();
    void loadThreads();
  }

  async function addMemory(e: React.FormEvent) {
    e.preventDefault();
    if (!newMemText.trim()) return;
    await fetch("/api/chat/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newMemText.trim(), category: "preference" }),
    });
    setNewMemText("");
    void loadMemories();
  }

  async function removeMemory(id: string) {
    await fetch(`/api/chat/memory?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    void loadMemories();
  }

  async function saveRules() {
    setSavingRules(true);
    try {
      await fetch("/api/chat/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: rulesDraft }),
      });
      setCustomRules(rulesDraft.trim());
      setRulesModalOpen(false);
    } finally {
      setSavingRules(false);
    }
  }

  const chatBody = useMemo(() => ({ threadId }), [threadId]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || busy) return;
    sendMessage({ text: input.trim() }, { body: chatBody });
    setInput("");
  }

  return (
    <>
      <PageHeader
        title="AI Operator"
        subtitle="Deploys apps, designs & edits app files, manages databases, and remembers your preferences."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setRulesModalOpen(true)}>
              <BookOpen size={13} />
              Custom Rules
              {customRules && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
            </Button>
            {meta && (
              <Badge tone={meta.hasKey || meta.provider === "custom" ? "ok" : "warn"}>
                <Sparkles size={11} /> {meta.modelName || meta.label} · {meta.model}
                {!meta.hasKey && meta.provider !== "custom" && " · no key"}
              </Badge>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[270px_1fr]">
        {/* Left Sidebar: Chat History + Persistent Memory */}
        <Card className="flex h-[calc(100vh-14rem)] min-h-[420px] flex-col p-3">
          <Button size="sm" onClick={startNewChat} className="mb-3 w-full">
            <Plus size={14} /> New Chat
          </Button>

          <div className="mb-3 grid grid-cols-2 gap-1 rounded-[var(--radius)] bg-muted/60 p-1">
            <button
              type="button"
              onClick={() => setSidebarTab("history")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs font-medium transition",
                sidebarTab === "history"
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <MessageSquare size={12} /> History ({threads.length})
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab("memory")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-xl py-1.5 text-xs font-medium transition",
                sidebarTab === "memory"
                  ? "bg-card text-primary shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Brain size={12} /> Memory ({memories.length})
            </button>
          </div>

          {sidebarTab === "history" ? (
            <div className="flex-1 space-y-1 overflow-y-auto pr-1">
              {threads.length === 0 ? (
                <p className="py-8 text-center text-xs text-muted-foreground">
                  No saved chats yet. Start a conversation!
                </p>
              ) : (
                threads.map((t) => (
                  <div
                    key={t.id}
                    className={cn(
                      "group flex items-center gap-2 rounded-[var(--radius)] px-3 py-2 text-xs transition cursor-pointer",
                      t.id === threadId
                        ? "bg-primary text-primary-foreground font-medium"
                        : "text-muted-foreground hover:bg-primary/10 hover:text-foreground",
                    )}
                    onClick={() => void openThread(t.id)}
                  >
                    <MessageSquare size={13} className="shrink-0 opacity-75" />
                    <span className="min-w-0 flex-1 truncate">{t.title}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeThread(t.id);
                      }}
                      className={cn(
                        "rounded p-1 opacity-0 transition group-hover:opacity-100",
                        t.id === threadId
                          ? "hover:bg-white/20 text-white"
                          : "hover:bg-destructive/10 hover:text-destructive",
                      )}
                      aria-label="Delete chat"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="flex flex-1 flex-col overflow-hidden">
              <form onSubmit={addMemory} className="mb-2.5 flex gap-1.5">
                <Input
                  value={newMemText}
                  onChange={(e) => setNewMemText(e.target.value)}
                  placeholder="Remember something..."
                  className="h-8 text-xs"
                />
                <Button type="submit" size="sm" variant="subtle" className="px-2.5">
                  <Plus size={13} />
                </Button>
              </form>
              <div className="flex-1 space-y-1.5 overflow-y-auto pr-1">
                {memories.length === 0 ? (
                  <p className="py-8 text-center text-xs text-muted-foreground">
                    Nothing remembered yet. Ask the AI to remember anything!
                  </p>
                ) : (
                  memories.map((m) => (
                    <div
                      key={m.id}
                      className="group flex items-start gap-2 rounded-[var(--radius)] border border-border/70 bg-muted/30 p-2.5 text-xs"
                    >
                      <span className="flex-1 leading-relaxed text-foreground">{m.content}</span>
                      <button
                        type="button"
                        onClick={() => void removeMemory(m.id)}
                        className="rounded p-1 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                        aria-label="Delete memory"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </Card>

        {/* Right Main Chat Area */}
        <Card className="flex h-[calc(100vh-14rem)] min-h-[420px] flex-col p-0">
          <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                <span className="bg-theme-r-gradient flex h-12 w-12 items-center justify-center rounded-2xl text-white shadow-sm">
                  <Bot size={22} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    Ask for anything on this server
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    I can design &amp; edit files inside your apps, manage databases, and remember your rules across chats.
                  </p>
                </div>
                <div className="flex max-w-xl flex-wrap justify-center gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => sendMessage({ text: s }, { body: chatBody })}
                      className="rounded-full border border-border bg-muted/50 px-3 py-1.5 text-[11px] text-muted-foreground transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
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
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                      <Bot size={14} />
                    </span>
                  )}
                  <div
                    className={cn(
                      "max-w-[85%] space-y-2 rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                      m.role === "user"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "border border-border bg-muted/40 text-foreground",
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
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground"
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
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <User size={14} />
                    </span>
                  )}
                </div>
              ))
            )}
            {busy && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-1.5 w-1.5 animate-pulse-soft rounded-full bg-primary" />
                working…
              </p>
            )}
            {error && (
              <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error.message}
              </p>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={submit} className="border-t border-border p-3">
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-background/60 p-2 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
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
                placeholder="Ask to deploy, design an app, remember a rule, or inspect logs…"
                className="max-h-36 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              {busy ? (
                <Button type="button" size="icon" variant="danger" onClick={stop} aria-label="Stop">
                  <Square size={14} />
                </Button>
              ) : (
                <Button type="submit" size="icon" disabled={!input.trim()} aria-label="Send">
                  <ArrowUp size={15} />
                </Button>
              )}
            </div>
          </form>
        </Card>
      </div>

      {/* Custom Rules Modal */}
      <Modal
        open={rulesModalOpen}
        onClose={() => setRulesModalOpen(false)}
        title="Custom AI Operator Rules"
        description="These rules are injected into every conversation with the AI Operator."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRulesModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void saveRules()} loading={savingRules}>
              Save Rules
            </Button>
          </>
        }
      >
        <Textarea
          value={rulesDraft}
          onChange={(e) => setRulesDraft(e.target.value)}
          placeholder="Example:&#10;- Always design apps with Tailwind CSS and AdminUX blue theme&#10;- Reply in Somali unless asked otherwise&#10;- Always back up before modifying production files"
          className="min-h-[160px]"
        />
      </Modal>
    </>
  );
}
