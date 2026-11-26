import crypto from "node:crypto";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { tool } from "ai";
import { z } from "zod";
import { all, execute, getSetting, setSetting } from "./db";
import * as files from "./files";
import * as ops from "./ops";

export type ProviderId = "openai" | "anthropic" | "deepseek" | "custom";
export type CustomProtocol = "openai" | "anthropic";

export const PROVIDERS: { id: ProviderId; label: string; models: string[]; envKey: string }[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    models: ["deepseek-chat", "deepseek-reasoner"],
    envKey: "DEEPSEEK_API_KEY",
  },
  {
    id: "openai",
    label: "OpenAI",
    models: ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "o4-mini"],
    envKey: "OPENAI_API_KEY",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5"],
    envKey: "ANTHROPIC_API_KEY",
  },
  {
    id: "custom",
    label: "Custom API",
    models: [],
    envKey: "CUSTOM_AI_API_KEY",
  },
];

export async function aiConfig() {
  const provider = ((await getSetting("ai_provider")) || "deepseek") as ProviderId;
  const meta = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];

  if (meta.id === "custom") {
    const baseUrl = ((await getSetting("ai_custom_base_url")) || "").trim();
    const protocol = (((await getSetting("ai_custom_protocol")) || "openai") === "anthropic"
      ? "anthropic"
      : "openai") as CustomProtocol;
    const modelId = ((await getSetting("ai_custom_model_id")) || "").trim();
    const modelName = ((await getSetting("ai_custom_model_name")) || modelId || "Custom Model").trim();
    const key = (await getSetting("ai_custom_key")) || process.env.CUSTOM_AI_API_KEY || "";
    return {
      provider: meta.id,
      model: modelId,
      modelName,
      baseUrl,
      protocol,
      key,
      label: modelName || "Custom API",
    };
  }

  const model = (await getSetting("ai_model")) || meta.models[0];
  const key =
    (await getSetting(`ai_${meta.id}_key`)) || process.env[meta.envKey] || "";
  return {
    provider: meta.id,
    model,
    modelName: model,
    baseUrl: "",
    protocol: "openai" as CustomProtocol,
    key,
    label: meta.label,
  };
}

export async function getModel() {
  const cfg = await aiConfig();
  if (cfg.provider === "custom") {
    if (!cfg.baseUrl) {
      throw new Error("Custom AI provider needs an API Base URL (link). Add one in Settings → AI.");
    }
    if (!cfg.model) {
      throw new Error("Custom AI provider needs a Model ID. Add one in Settings → AI.");
    }
    const apiKey = cfg.key || "no-key";
    if (cfg.protocol === "anthropic") {
      return createAnthropic({ baseURL: cfg.baseUrl, apiKey })(cfg.model);
    }
    return createOpenAI({ baseURL: cfg.baseUrl, apiKey })(cfg.model);
  }

  if (!cfg.key) {
    throw new Error(
      `No API key for ${cfg.label}. Add one in Settings → AI, or set ${PROVIDERS.find((p) => p.id === cfg.provider)?.envKey}.`,
    );
  }
  if (cfg.provider === "openai") {
    return createOpenAI({ apiKey: cfg.key })(cfg.model);
  }
  if (cfg.provider === "anthropic") {
    return createAnthropic({ apiKey: cfg.key })(cfg.model);
  }
  return createDeepSeek({ apiKey: cfg.key })(cfg.model);
}

/* ───────────────────────── memory & custom rules ───────────────────────── */

export type MemoryRow = {
  id: string;
  user_id: string;
  content: string;
  category: string;
  created_at: number;
};

export async function listMemories(userId: string): Promise<MemoryRow[]> {
  return all<MemoryRow>(
    "SELECT id, user_id, content, category, created_at FROM ai_memories WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
    [userId],
  );
}

export async function saveMemory(userId: string, content: string, category = "general"): Promise<MemoryRow> {
  const clean = content.trim();
  if (!clean) throw new Error("Memory content cannot be empty.");
  const id = crypto.randomUUID().slice(0, 12);
  const created_at = Date.now();
  await execute(
    "INSERT INTO ai_memories(id, user_id, content, category, created_at) VALUES(?,?,?,?,?)",
    [id, userId, clean, category.trim() || "general", created_at],
  );
  return { id, user_id: userId, content: clean, category, created_at };
}

export async function deleteMemory(userId: string, id: string): Promise<void> {
  await execute("DELETE FROM ai_memories WHERE id = ? AND user_id = ?", [id, userId]);
}

export async function getCustomRules(): Promise<string> {
  return (await getSetting("ai_custom_rules")) || "";
}

export async function setCustomRules(rules: string): Promise<void> {
  await setSetting("ai_custom_rules", rules.trim() || null);
}

export async function buildSystemPrompt(userId: string, userEmail: string): Promise<string> {
  const [memories, customRules] = await Promise.all([
    listMemories(userId).catch(() => []),
    getCustomRules().catch(() => ""),
  ]);

  const parts = [
    SYSTEM_PROMPT,
    `Signed-in operator: ${userEmail}`,
  ];

  if (customRules) {
    parts.push(`## Custom Operator Rules (always follow these)\n${customRules}`);
  }

  if (memories.length > 0) {
    const lines = memories
      .slice(0, 40)
      .map((m) => `- [${m.category}] (${m.id}) ${m.content}`);
    parts.push(
      `## Persistent Memory (facts remembered for this user)\n${lines.join("\n")}`,
    );
  }

  return parts.join("\n\n");
}

export const SYSTEM_PROMPT = `You are the built-in operator of "Caaqil", a self-hosted hosting panel.

You can inspect and change the server through tools: Docker apps (PHP, Node.js, static, custom images),
editing and designing files inside any app (HTML, CSS, JS, PHP, React, config files),
databases (MySQL, MariaDB, PostgreSQL, MongoDB, Redis), domains/Traefik routing, external MySQL servers,
and persistent long-term memory.

Rules:
- Be concise and concrete. Prefer doing the work over explaining it.
- Before destructive actions (delete app, delete database, remove domain, delete_app_file) restate what will be deleted and ask for confirmation unless the user already confirmed in this thread.
- When the user shares a preference, project detail, credential convention, or asks you to remember anything, call remember_fact right away so you retain it across future conversations.
- When designing or editing an app, inspect its files first with list_app_files / read_app_file, then write clean, complete files with write_app_file.
- App names must be lowercase letters, numbers or dashes.
- When creating a database for an app, create the database first, then tell the user which env vars to set
  (e.g. for MySQL: DB_HOST=db-<name>, DB_PORT=3306, DB_DATABASE, DB_USERNAME, DB_PASSWORD).
- PHP apps run on php:*-apache images with the repository mounted at /var/www/html.
- Never invent server facts. Call a tool when you need the current state.
- Answer in the language the user writes in.`;

export function createTools(userId: string) {
  return {
    ...tools,
    remember_fact: tool({
      description:
        "Save a persistent memory for the user so you remember preferences, architecture, rules, or any detail across all future chats.",
      inputSchema: z.object({
        content: z.string().describe("Clear, self-contained fact or preference to remember"),
        category: z.string().optional().describe("Category such as preference, app, server, rule, general"),
      }),
      execute: async ({ content, category }) => {
        const mem = await saveMemory(userId, content, category || "general");
        return { ok: true, id: mem.id, saved: mem.content };
      },
    }),
    list_memories: tool({
      description: "List all saved persistent memories for this user.",
      inputSchema: z.object({}),
      execute: async () => listMemories(userId),
    }),
    forget_memory: tool({
      description: "Delete a saved persistent memory by id.",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        await deleteMemory(userId, id);
        return { ok: true, deleted: id };
      },
    }),
  };
}

export const tools = {
  list_apps: tool({
    description: "List every application managed by the panel, with status and image.",
    inputSchema: z.object({}),
    execute: async () => {
      const apps = await ops.listApps();
      return apps.map((a) => ({
        name: a.name,
        runtime: a.runtime,
        image: a.image,
        port: a.port,
        status: a.status,
        domain: a.domain,
        git: a.git_url,
      }));
    },
  }),

  create_app: tool({
    description:
      "Create and start an application. Use a preset id such as php84, php83, laravel, wordpress, node22, static, custom.",
    inputSchema: z.object({
      name: z.string().describe("Lowercase app name, e.g. blog"),
      preset: z.string().describe("Preset id: php84, php83, php82, laravel, wordpress, node22, node20, static, custom"),
      image: z.string().optional().describe("Docker image (required only for the custom preset)"),
      port: z.number().optional().describe("Container port the app listens on"),
      gitUrl: z.string().optional().describe("Git repository to clone into the app"),
      branch: z.string().optional(),
      domain: z.string().optional().describe("Primary domain, e.g. blog.example.com"),
      pathPrefix: z.string().optional().describe("Optional path prefix like /blog on the panel domain"),
      pathHost: z.string().optional().describe("Hostname for the path route"),
      env: z.record(z.string()).optional().describe("Environment variables"),
    }),
    execute: async (input) => {
      const app = await ops.createApp(input, "ai-agent");
      return { ok: true, name: app.name, status: app.status, image: app.image, port: app.port };
    },
  }),

  set_app_path: tool({
    description:
      "Serve an app under a path prefix on a host, e.g. https://panel.example.com/blog. Pass an empty path to remove the route.",
    inputSchema: z.object({
      name: z.string().describe("App name"),
      path: z.string().describe("Path prefix such as /blog, or empty to remove"),
      host: z.string().optional().describe("Hostname, defaults to the panel domain"),
      strip: z.boolean().optional().describe("Strip the prefix before proxying (default true)"),
    }),
    execute: async ({ name, path, host, strip }) => {
      const app = await ops.setAppRoute(name, { path, host, strip }, "ai-agent");
      return {
        ok: true,
        host: app.path_host,
        path: app.path_prefix,
        url: app.path_prefix ? `https://${app.path_host}${app.path_prefix}` : null,
      };
    },
  }),

  app_action: tool({
    description: "Start, stop, restart or redeploy an app.",
    inputSchema: z.object({
      name: z.string(),
      action: z.enum(["start", "stop", "restart", "redeploy"]),
    }),
    execute: async ({ name, action }) => {
      if (action === "redeploy") {
        const app = await ops.redeployApp(name, "ai-agent");
        return { ok: true, status: app.status };
      }
      return ops.appAction(name, action, "ai-agent");
    },
  }),

  delete_app: tool({
    description: "Permanently delete an app, its container and its cloned source. Ask the user first.",
    inputSchema: z.object({ name: z.string() }),
    execute: async ({ name }) => ops.appAction(name, "delete", "ai-agent"),
  }),

  app_logs: tool({
    description: "Read the latest container logs of an app.",
    inputSchema: z.object({ name: z.string(), lines: z.number().min(10).max(1000).optional() }),
    execute: async ({ name, lines }) => ({ logs: await ops.appLogs(name, lines ?? 120) }),
  }),

  list_databases: tool({
    description: "List databases managed by the panel, including exposed public ports.",
    inputSchema: z.object({}),
    execute: async () => {
      const rows = await ops.listDatabases();
      return rows.map((d) => ({
        name: d.name,
        engine: d.engine,
        version: d.version,
        status: d.status,
        remote: d.remote === 1,
        publicPort: d.public_port,
        database: d.dbname,
        username: d.username,
      }));
    },
  }),

  create_database: tool({
    description: "Create a database container (mysql, mariadb, postgres, mongo, redis).",
    inputSchema: z.object({
      name: z.string(),
      engine: z.enum(["mysql", "mariadb", "postgres", "mongo", "redis"]),
      version: z.string().optional(),
      remote: z.boolean().optional().describe("Publish a public port so clients outside the server can connect"),
    }),
    execute: async (input) => {
      const db = await ops.createDatabase(input, "ai-agent");
      return {
        ok: true,
        name: db.name,
        host: `db-${db.name}`,
        port: db.port,
        database: db.dbname,
        username: db.username,
        password: db.password,
        publicPort: db.public_port,
      };
    },
  }),

  delete_database: tool({
    description: "Delete a database container and its volume. Ask the user first — data is lost.",
    inputSchema: z.object({ name: z.string() }),
    execute: async ({ name }) => ops.databaseAction(name, "delete", "ai-agent"),
  }),

  expose_database: tool({
    description: "Expose a MySQL/MariaDB database on a public port with a '%' user for remote clients.",
    inputSchema: z.object({ name: z.string(), publicPort: z.number().optional() }),
    execute: async ({ name, publicPort }) =>
      ops.databaseAction(name, "expose", "ai-agent", publicPort),
  }),

  list_external_servers: tool({
    description: "List external MySQL servers registered for remote management.",
    inputSchema: z.object({}),
    execute: async () => {
      const rows = await ops.listTargets();
      return rows.map((t) => ({ id: t.id, name: t.name, host: t.host, port: t.port, username: t.username }));
    },
  }),

  query_external_server: tool({
    description: "Run a read-only SQL query (SELECT/SHOW/DESCRIBE/EXPLAIN) on an external MySQL server.",
    inputSchema: z.object({ id: z.string(), sql: z.string() }),
    execute: async ({ id, sql }) => ops.targetQuery(id, sql),
  }),

  list_domains: tool({
    description: "List domains and which app they route to.",
    inputSchema: z.object({}),
    execute: async () => ops.listDomains(),
  }),

  add_domain: tool({
    description: "Attach a domain to an app. Traefik will request a Let's Encrypt certificate automatically.",
    inputSchema: z.object({ host: z.string(), app: z.string() }),
    execute: async ({ host, app }) => ops.addDomain(host, app, "ai-agent"),
  }),

  system_stats: tool({
    description: "CPU, memory, disk, uptime and Docker status of this server.",
    inputSchema: z.object({}),
    execute: async () => ops.overview().then((o) => o.stats),
  }),

  list_app_files: tool({
    description: "List files and folders inside an app's directory so you can inspect or design its code.",
    inputSchema: z.object({
      app: z.string().describe("App name"),
      path: z.string().optional().describe("Relative folder path, e.g. / or /src (defaults to /)"),
    }),
    execute: async ({ app, path }) => files.list(app, path || "/"),
  }),

  read_app_file: tool({
    description: "Read a file inside an app's directory.",
    inputSchema: z.object({
      app: z.string().describe("App name"),
      path: z.string().describe("Relative file path, e.g. /index.php or /public/index.html"),
    }),
    execute: async ({ app, path }) => files.read(app, path),
  }),

  write_app_file: tool({
    description: "Create or overwrite a file inside an app's directory (HTML, CSS, JS, PHP, JSON, etc.) to design or edit the app.",
    inputSchema: z.object({
      app: z.string().describe("App name"),
      path: z.string().describe("Relative file path, e.g. /index.html or /styles.css"),
      content: z.string().describe("Complete file contents"),
    }),
    execute: async ({ app, path, content }) => files.write(app, path, content),
  }),

  mkdir_app: tool({
    description: "Create a folder inside an app's directory.",
    inputSchema: z.object({
      app: z.string(),
      path: z.string().describe("Relative folder path, e.g. /assets/css"),
    }),
    execute: async ({ app, path }) => files.mkdir(app, path),
  }),

  delete_app_file: tool({
    description: "Delete a file or folder inside an app's directory. Ask the user first.",
    inputSchema: z.object({
      app: z.string(),
      path: z.string(),
    }),
    execute: async ({ app, path }) => files.remove(app, path),
  }),
};
