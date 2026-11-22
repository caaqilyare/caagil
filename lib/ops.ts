import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import { execute, one, query, logActivity, getSetting, setSetting } from "./db";
import { randomId, shortPassword } from "./crypto";
import { ENGINES, findPreset } from "./presets";
import { cloneOrPull } from "./git";
import {
  containerIp,
  containerLogs,
  docker,
  ensureNetwork,
  HOST_SITES_DIR,
  NETWORK,
  pullIfMissing,
  removeContainerSafe,
  runContainer,
  traefikLabels,
  SITES_DIR,
  type TraefikRoute,
} from "./docker";
import { systemStats } from "./stats";
import { createJob, jobFail, jobFinish, jobStep } from "./jobs";
import {
  createAppDatabase,
  createAppDatabaseUser,
  dropAppDatabase,
  installWordPress,
  MYSQL_HOST,
  WP_PROXY_HTTPS,
  type WpInstallInput,
} from "./wp";
import {
  detectPublicIp,
  EDGE_DIR,
  isIpAddress,
  normalizeDomain,
  panelEdgeSettings,
  writePanelEdge,
} from "./edge";

export type AppRow = {
  id: string;
  name: string;
  runtime: string;
  image: string;
  command: string | null;
  port: number;
  env: unknown;
  domain: string | null;
  git_url: string | null;
  branch: string | null;
  doc_root: string | null;
  mount_path: string | null;
  path_prefix: string | null;
  path_host: string | null;
  strip_prefix: number;
  php_version: string | null;
  status: string;
  container_id: string | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
};

/** Database provisioned on the panel MySQL server for an app (WordPress etc.). */
export type AppDbRow = {
  id: string;
  app_id: string;
  name: string;
  username: string;
  password: string;
  host: string;
  created_at: number;
};

export type DatabaseRow = {
  id: string;
  name: string;
  engine: string;
  version: string | null;
  port: number;
  public_port: number | null;
  username: string | null;
  password: string | null;
  dbname: string | null;
  container_id: string | null;
  volume: string | null;
  remote: number;
  status: string;
  created_at: number;
};

export type TargetRow = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string | null;
  use_tls: number;
  created_at: number;
};

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) {
    throw new Error("Name must be 1-40 chars: lowercase letters, numbers or dashes.");
  }
  return slug;
}

/** Host used for path routes when the app does not set one explicitly. */
async function defaultRouteHost(): Promise<string | null> {
  const saved = await getSetting("panel_domain").catch(() => null);
  if (saved) return saved.trim().toLowerCase();
  if (process.env.PANEL_DOMAIN) return process.env.PANEL_DOMAIN.trim().toLowerCase();
  try {
    return new URL(process.env.PANEL_URL ?? "").hostname || null;
  } catch {
    return null;
  }
}

const RESERVED_PATHS = new Set([
  "api", "login", "logout", "apps", "databases", "domains", "activity",
  "files", "ai", "settings", "targets", "_next", "favicon.ico",
]);

export function normalizePath(input: string): string {
  const path = input.trim().toLowerCase().replace(/\/+$/, "");
  if (!/^\/[a-z0-9][a-z0-9._-]{0,60}$/.test(path)) {
    throw new Error("Path must look like /name — a leading slash, letters, numbers, dot, dash or underscore.");
  }
  if (RESERVED_PATHS.has(path.slice(1))) {
    throw new Error(`"${path}" is reserved by the panel. Pick another path.`);
  }
  return path;
}

function parseEnv(value: unknown): Record<string, string> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value as Record<string, string>;
}

/* ────────────────────────────── apps ────────────────────────────── */

export async function listApps(): Promise<AppRow[]> {
  return query<AppRow[]>("SELECT * FROM apps ORDER BY created_at DESC");
}

export async function getApp(id: string): Promise<AppRow | null> {
  return one<AppRow>("SELECT * FROM apps WHERE id = ? OR name = ?", [id, id]);
}

async function applyApp(app: AppRow) {
  const rows = await query<{ host: string }[]>(
    "SELECT host FROM domains WHERE app_id = ?",
    [app.id],
  );
  const hosts = Array.from(
    new Set([...rows.map((r) => r.host), ...(app.domain ? [app.domain] : [])]),
  ).filter(Boolean);

  const routes: TraefikRoute[] = hosts.map((host) => ({ host }));
  if (app.path_prefix) {
    routes.push({
      host: app.path_host || (await defaultRouteHost()),
      path: app.path_prefix,
      strip: Number(app.strip_prefix) !== 0,
    });
  }

  const env = { ...parseEnv(app.env) };
  const binds: string[] = [];
  if (app.mount_path) {
    // Give every app a persistent folder on the host, even without a git repo.
    await fs.mkdir(path.join(SITES_DIR, app.name), { recursive: true }).catch(() => {});
    binds.push(`${HOST_SITES_DIR}/${app.name}:${app.mount_path}`);
  }

  await pullIfMissing(app.image);
  const container = await runContainer({
    name: app.name,
    image: app.image,
    port: Number(app.port) || 80,
    command: app.command ?? undefined,
    env,
    binds,
    labels: traefikLabels(app.id, routes, Number(app.port) || 80),
  });

  await execute("UPDATE apps SET container_id = ?, status = 'running', updated_at = ? WHERE id = ?", [
    container.id,
    Date.now(),
    app.id,
  ]);
  return container.id;
}

export type CreateAppInput = {
  name: string;
  preset: string;
  image?: string;
  port?: number;
  command?: string;
  gitUrl?: string;
  branch?: string;
  domain?: string;
  /** Serve the app under a path prefix such as /blog. */
  pathPrefix?: string;
  /** Hostname for the path route. Defaults to the panel domain. */
  pathHost?: string;
  stripPrefix?: boolean;
  env?: Record<string, string>;
  notes?: string;
  /** WordPress one-click install options (WordPress runtime only). */
  wp?: {
    autoInstall?: boolean;
    title?: string;
    adminUser?: string;
    adminPassword?: string;
    adminEmail?: string;
  };
};

/** Reports deploy progress so the UI can render a live step-by-step screen. */
export type ProgressReporter = (
  step: string,
  status: "active" | "done" | "error",
  detail?: string,
) => void;

export async function createApp(
  input: CreateAppInput,
  actor = "system",
  report?: ProgressReporter,
): Promise<AppRow & { wp_warning?: string | null }> {
  report?.("validate", "active");
  const name = slugify(input.name);
  const preset = findPreset(input.preset) ?? findPreset("php84")!;
  const image = (input.image || preset.image).trim();
  if (!image) throw new Error("A Docker image is required for the custom runtime.");

  const existing = await one("SELECT id FROM apps WHERE name = ?", [name]);
  if (existing) throw new Error(`An app named "${name}" already exists.`);

  const primaryHost = input.domain?.trim().toLowerCase() || null;
  if (primaryHost) {
    const attached = await one<{ app_name: string | null }>(
      "SELECT a.name AS app_name FROM domains d LEFT JOIN apps a ON a.id = d.app_id WHERE d.host = ? LIMIT 1",
      [primaryHost],
    );
    if (attached) {
      throw new Error(
        `${primaryHost} is already attached to ${attached.app_name ?? "another app"}. Remove it there first.`,
      );
    }
  }
  report?.("validate", "done");

  if (input.gitUrl) {
    report?.("clone", "active", input.gitUrl);
    await cloneOrPull(input.gitUrl, input.branch || null, name);
    report?.("clone", "done", input.branch || "main");
  }

  const id = randomId("app");
  const now = Date.now();
  const port = Number(input.port || preset.port);
  const env = { ...(preset.env ?? {}), ...(input.env ?? {}) };

  // WordPress one-click: a managed database on the panel MySQL server plus
  // reverse-proxy HTTPS detection — unless the user wired their own DB env.
  const isWp = preset.id === "wordpress" || /wordpress/i.test(image);
  const autoWp = isWp && input.wp?.autoInstall !== false;
  let wpDb: { name: string; username: string; password: string; host: string } | null = null;
  if (isWp && !env.WORDPRESS_DB_HOST) {
    report?.("database", "active");
    const dbName = (await createAppDatabase(name)).name;
    report?.("database", "done", dbName);
    report?.("dbuser", "active");
    const { username, password } = await createAppDatabaseUser(name);
    report?.("dbuser", "done", username);
    wpDb = { name: dbName, username, password, host: MYSQL_HOST };
    env.WORDPRESS_DB_HOST = wpDb.host;
    env.WORDPRESS_DB_NAME = wpDb.name;
    env.WORDPRESS_DB_USER = wpDb.username;
    env.WORDPRESS_DB_PASSWORD = wpDb.password;
    if (!env.WORDPRESS_CONFIG_EXTRA) env.WORDPRESS_CONFIG_EXTRA = WP_PROXY_HTTPS;
  }

  // Path route: explicit from the user, or a default /<name> route so a
  // WordPress app gets a working URL immediately.
  let pathPrefix = input.pathPrefix ? normalizePath(input.pathPrefix) : null;
  let pathHost = input.pathHost?.trim().toLowerCase() || null;
  if (pathPrefix && !pathHost) pathHost = await defaultRouteHost();
  if (autoWp && !primaryHost && !pathPrefix) {
    const host = await defaultRouteHost();
    if (host && !RESERVED_PATHS.has(name)) {
      const clash = await one("SELECT id FROM apps WHERE path_prefix = ? AND path_host <=> ?", [
        `/${name}`,
        host,
      ]);
      if (!clash) {
        pathPrefix = `/${name}`;
        pathHost = host;
      }
    }
  }

  report?.("pull", "active", image);
  await pullIfMissing(image);
  report?.("pull", "done");

  report?.("container", "active");
  await execute(
    `INSERT INTO apps (id, name, runtime, image, command, port, env, domain, git_url, branch, doc_root, mount_path, path_prefix, path_host, strip_prefix, php_version, status, notes, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      name,
      input.preset,
      image,
      input.command ?? preset.command ?? null,
      port,
      JSON.stringify(env),
      primaryHost,
      input.gitUrl || null,
      input.branch || null,
      preset.docRoot || null,
      preset.mountPath || null,
      pathPrefix,
      pathHost,
      input.stripPrefix === false ? 0 : 1,
      preset.group === "php" ? (preset.id.match(/php(\d+)/)?.[1] ?? null) : null,
      "created",
      input.notes || null,
      now,
      now,
    ],
  );

  if (primaryHost) {
    await execute("INSERT IGNORE INTO domains(id, host, app_id, cert, created_at) VALUES(?,?,?,?,?)", [
      randomId("dom"),
      primaryHost,
      id,
      "letsencrypt",
      now,
    ]);
  }

  if (wpDb) {
    await execute(
      "INSERT INTO app_databases(id, app_id, name, username, password, host, created_at) VALUES(?,?,?,?,?,?,?)",
      [randomId("wpdb"), id, wpDb.name, wpDb.username, wpDb.password, wpDb.host, now],
    );
  }

  const app = (await getApp(id))!;
  try {
    await applyApp(app);
  } catch (err) {
    // Roll back so a failed create does not leave a ghost app behind.
    report?.("container", "error", err instanceof Error ? err.message : String(err));
    if (wpDb) {
      await dropAppDatabase(wpDb.name, wpDb.username).catch(() => {});
      await execute("DELETE FROM app_databases WHERE app_id = ?", [id]);
    }
    await execute("DELETE FROM domains WHERE app_id = ?", [id]);
    await execute("DELETE FROM apps WHERE id = ?", [id]);
    await fs.rm(path.join(SITES_DIR, name), { recursive: true, force: true }).catch(() => {});
    await logActivity("app.create", `${name}: ${err instanceof Error ? err.message : err}`, actor, false);
    throw err;
  }
  report?.("container", "done", `caagil-${name}`);

  let wpWarning: string | null = null;
  if (autoWp) {
    report?.("wp", "active", "waiting for WordPress to initialize…");
    try {
      const fresh = (await getApp(id))!;
      const res = await installWordPress(fresh, {
        title: input.wp?.title?.trim() || name,
        adminUser: input.wp?.adminUser,
        adminPassword: input.wp?.adminPassword,
        adminEmail: input.wp?.adminEmail,
      });
      report?.("wp", "done", res.url);
      await logActivity("wp.install", `${name} → ${res.url} (admin: ${res.adminUser})`, actor);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      wpWarning = `WordPress auto-install failed: ${msg}`;
      report?.("wp", "error", msg);
      await execute(
        "UPDATE apps SET notes = CONCAT(COALESCE(notes, ''), ?) WHERE id = ?",
        [`${wpWarning} — press "WP" on the app card to retry.\n`, id],
      );
      await logActivity("wp.install", `${name}: ${msg}`, actor, false);
    }
  }

  await logActivity(
    "app.create",
    `${name} (${image}) on port ${port}${pathPrefix && pathHost ? ` at ${pathHost}${pathPrefix}` : ""}`,
    actor,
  );
  return { ...(await getApp(id))!, wp_warning: wpWarning };
}

/**
 * Job-wrapped create used by the UI: validates cheap things synchronously,
 * then runs the deploy in the background while the client polls /api/jobs/<id>
 * for live step-by-step progress.
 */
export async function startAppCreate(
  input: CreateAppInput,
  actor = "system",
): Promise<{ job: string }> {
  const name = slugify(input.name);
  if (await one("SELECT id FROM apps WHERE name = ?", [name])) {
    throw new Error(`An app named "${name}" already exists.`);
  }
  const preset = findPreset(input.preset) ?? findPreset("php84")!;
  const isWp = preset.id === "wordpress" || /wordpress/i.test(input.image || preset.image);

  const steps: { key: string; label: string }[] = [
    { key: "validate", label: "Checking name & settings" },
  ];
  if (input.gitUrl) steps.push({ key: "clone", label: "Cloning Git repository" });
  if (isWp && !input.env?.WORDPRESS_DB_HOST) {
    steps.push({ key: "database", label: "Creating MySQL database" });
    steps.push({ key: "dbuser", label: "Creating database user" });
  }
  steps.push({ key: "pull", label: "Pulling Docker image" });
  steps.push({ key: "container", label: "Starting container & routing" });
  if (isWp && input.wp?.autoInstall !== false) {
    steps.push({ key: "wp", label: "Installing WordPress" });
  }

  const jobId = createJob("app.create", `Deploy ${name}`, steps);
  void (async () => {
    try {
      const app = await createApp(input, actor, (key, status, detail) =>
        jobStep(jobId, key, status, detail),
      );
      jobFinish(jobId, { name: app.name, wp_warning: app.wp_warning ?? null });
    } catch (err) {
      jobFail(jobId, err instanceof Error ? err.message : String(err));
    }
  })();

  return { job: jobId };
}

/** Job-wrapped WordPress install for the UI (same polling contract). */
export async function startWpInstall(
  id: string,
  input: WpInstallInput,
  actor = "system",
): Promise<{ job: string }> {
  const app = await getApp(id);
  if (!app) throw new Error("App not found");
  if (!/wordpress/i.test(`${app.runtime} ${app.image}`)) {
    throw new Error("WP install only applies to WordPress apps.");
  }

  const jobId = createJob("app.wpinstall", `Install WordPress · ${app.name}`, [
    { key: "connect", label: "Checking app container" },
    { key: "wp", label: "Running the WordPress installer" },
  ]);

  void (async () => {
    try {
      jobStep(jobId, "connect", "active");
      const fresh = (await getApp(app.id))!;
      jobStep(jobId, "connect", "done", fresh.status);
      jobStep(jobId, "wp", "active", "wp-cli is working…");
      const res = await installWordPress(fresh, input);
      jobStep(jobId, "wp", "done", res.url);
      await logActivity("wp.install", `${app.name} → ${res.url} (admin: ${res.adminUser})`, actor);
      jobFinish(jobId, { url: res.url, adminUser: res.adminUser });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logActivity("wp.install", `${app.name}: ${msg}`, actor, false).catch(() => {});
      jobFail(jobId, msg);
    }
  })();

  return { job: jobId };
}

/** Mount an app under a path prefix (e.g. https://panel.example.com/blog). */
export async function setAppRoute(
  id: string,
  input: { host?: string | null; path?: string | null; strip?: boolean },
  actor = "system",
) {
  const app = await getApp(id);
  if (!app) throw new Error("App not found");

  const path = input.path && input.path.trim() ? normalizePath(input.path) : null;
  const host = path ? input.host?.trim().toLowerCase() || (await defaultRouteHost()) : null;
  if (path && !host) {
    throw new Error("A host is required for a path route. Set PANEL_DOMAIN or pass a domain.");
  }

  if (path && host) {
    const clash = await one<{ name: string }>(
      "SELECT name FROM apps WHERE path_prefix = ? AND path_host <=> ? AND id <> ?",
      [path, host, app.id],
    );
    if (clash) throw new Error(`${host}${path} is already used by ${clash.name}.`);
  }

  await execute(
    "UPDATE apps SET path_prefix = ?, path_host = ?, strip_prefix = ?, updated_at = ? WHERE id = ?",
    [path, host, input.strip === false ? 0 : 1, Date.now(), app.id],
  );
  await applyApp((await getApp(app.id))!);
  await logActivity("app.route", `${app.name} → ${host ?? "-"}${path ?? ""}`, actor);
  return (await getApp(app.id))!;
}

export async function redeployApp(id: string, actor = "system") {  const app = await getApp(id);
  if (!app) throw new Error("App not found");
  if (app.git_url) await cloneOrPull(app.git_url, app.branch, app.name);
  await applyApp(app);
  await logActivity("app.redeploy", app.name, actor);
  return (await getApp(id))!;
}

export async function appAction(
  id: string,
  action: "start" | "stop" | "restart" | "delete",
  actor = "system",
) {
  const app = await getApp(id);
  if (!app) throw new Error("App not found");

  if (action === "delete") {
    let warning: string | null = null;
    try {
      await removeContainerSafe(app.container_id, app.name);
    } catch (err) {
      warning = `container cleanup failed (${err instanceof Error ? err.message : String(err)})`;
    }
    const wpDb = await one<AppDbRow>("SELECT * FROM app_databases WHERE app_id = ?", [app.id]);
    if (wpDb) {
      try {
        await dropAppDatabase(wpDb.name, wpDb.username);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warning = warning
          ? `${warning}; database cleanup failed (${msg})`
          : `database cleanup failed (${msg})`;
      }
      await execute("DELETE FROM app_databases WHERE app_id = ?", [app.id]);
    }
    await execute("DELETE FROM domains WHERE app_id = ?", [app.id]);
    await execute("DELETE FROM apps WHERE id = ?", [app.id]);
    await fs.rm(path.join(SITES_DIR, app.name), { recursive: true, force: true }).catch(() => {});
    await logActivity("app.delete", warning ? `${app.name} (${warning})` : app.name, actor);
    return { deleted: true, warning };
  }

  if (!app.container_id) throw new Error("App has no container yet — redeploy it first.");
  const container = docker.getContainer(app.container_id);

  if (action === "start") {
    await container.start().catch(() => {});
    await execute("UPDATE apps SET status = 'running' WHERE id = ?", [app.id]);
  }
  if (action === "stop") {
    await container.stop({ t: 10 }).catch(() => {});
    await execute("UPDATE apps SET status = 'stopped' WHERE id = ?", [app.id]);
  }
  if (action === "restart") {
    await container.restart({ t: 10 }).catch(() => container.start());
    await execute("UPDATE apps SET status = 'running' WHERE id = ?", [app.id]);
  }

  await logActivity(`app.${action}`, app.name, actor);
  return { ok: true };
}

export async function appLogs(id: string, tail = 300): Promise<string> {
  const app = await getApp(id);
  if (!app?.container_id) throw new Error("App has no container yet.");
  return containerLogs(app.container_id, tail);
}

/* ────────────────── WordPress one-click installation ────────────────── */

/** (Re)run the WordPress installer for an existing app. */
export async function installWordPressForApp(
  id: string,
  input: WpInstallInput,
  actor = "system",
) {
  const app = await getApp(id);
  if (!app) throw new Error("App not found");
  if (!/wordpress/i.test(`${app.runtime} ${app.image}`)) {
    throw new Error("WP install only applies to WordPress apps.");
  }
  const res = await installWordPress(app, input);
  await logActivity("wp.install", `${app.name} → ${res.url} (admin: ${res.adminUser})`, actor);
  return { ok: true, url: res.url, adminUser: res.adminUser };
}

/* ──────────────────────────── databases ─────────────────────────── */

export async function listDatabases(): Promise<DatabaseRow[]> {
  return query<DatabaseRow[]>("SELECT * FROM db_services ORDER BY created_at DESC");
}

export async function getDatabase(id: string): Promise<DatabaseRow | null> {
  return one<DatabaseRow>("SELECT * FROM db_services WHERE id = ? OR name = ?", [id, id]);
}

function databaseEnv(db: DatabaseRow): { env: Record<string, string>; command?: string } {
  const pw = db.password || "";
  const user = db.username || "caagil";
  const name = db.dbname || db.name;
  switch (db.engine) {
    case "mysql":
    case "mariadb":
      return {
        env: {
          MYSQL_ROOT_PASSWORD: pw,
          MYSQL_DATABASE: name,
          MYSQL_USER: user,
          MYSQL_PASSWORD: pw,
        },
      };
    case "postgres":
      return {
        env: {
          POSTGRES_PASSWORD: pw,
          POSTGRES_USER: user,
          POSTGRES_DB: name,
        },
      };
    case "mongo":
      return {
        env: { MONGO_INITDB_ROOT_USERNAME: user, MONGO_INITDB_ROOT_PASSWORD: pw },
      };
    case "redis":
      return { env: {}, command: `redis-server --requirepass "${pw}" --appendonly yes` };
    default:
      throw new Error(`Unsupported engine ${db.engine}`);
  }
}

async function waitForMysql(ip: string, password: string, user = "root", tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const conn = await mysql.createConnection({
        host: ip,
        port: 3306,
        user,
        password,
        connectTimeout: 2000,
      });
      await conn.end();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

async function grantRemoteMysql(db: DatabaseRow) {
  if (!db.container_id) return;
  const ip = await containerIp(db.container_id);
  if (!ip) return;
  if (!(await waitForMysql(ip, db.password || ""))) return;

  const conn = await mysql.createConnection({
    host: ip,
    port: 3306,
    user: "root",
    password: db.password || "",
    connectTimeout: 5000,
  });
  try {
    const user = (db.username || "caagil").replace(/'/g, "");
    const dbname = (db.dbname || db.name).replace(/`/g, "");
    await conn.query(
      `CREATE USER IF NOT EXISTS '${user}'@'%' IDENTIFIED BY ${conn.escape(db.password || "")}`,
    );
    await conn.query(`GRANT ALL PRIVILEGES ON \`${dbname}\`.* TO '${user}'@'%'`);
    await conn.query("FLUSH PRIVILEGES");
  } finally {
    await conn.end();
  }
}

async function applyDatabase(db: DatabaseRow) {
  const { env, command } = databaseEnv(db);
  const port = Number(db.port);
  const image = `${db.engine === "mongo" ? "mongo" : db.engine === "postgres" ? "postgres" : db.engine}:${db.version}`;
  await pullIfMissing(image);

  const portBindings =
    db.remote && db.public_port
      ? { [`${port}/tcp`]: [{ HostIp: "0.0.0.0", HostPort: String(db.public_port) }] }
      : undefined;

  const existing = docker.getContainer(`caagil-db-${db.name}`);
  await existing
    .inspect()
    .then(async () => {
      await existing.stop({ t: 5 }).catch(() => {});
      await existing.remove({ force: true });
    })
    .catch(() => {});

  const container = await docker.createContainer({
    name: `caagil-db-${db.name}`,
    Image: image,
    Cmd: command ? ["sh", "-lc", command] : undefined,
    Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
    Labels: { "caagil.managed": "true", "caagil.kind": "database" },
    HostConfig: {
      RestartPolicy: { Name: "unless-stopped" },
      Binds: [`caagil-db-${db.name}:${db.engine === "mongo" ? "/data/db" : db.engine === "postgres" ? "/var/lib/postgresql/data" : db.engine === "redis" ? "/data" : "/var/lib/mysql"}`],
      NetworkMode: NETWORK,
      PortBindings: portBindings,
    },
    NetworkingConfig: { EndpointsConfig: { [NETWORK]: { Aliases: [`db-${db.name}`] } } },
  });

  await container.start();
  await execute("UPDATE db_services SET container_id = ?, status = 'running' WHERE id = ?", [
    container.id,
    db.id,
  ]);

  if (db.remote && (db.engine === "mysql" || db.engine === "mariadb")) {
    await grantRemoteMysql({ ...db, container_id: container.id }).catch(() => {});
  }
  return container.id;
}

export type CreateDatabaseInput = {
  name: string;
  engine: string;
  version?: string;
  remote?: boolean;
  publicPort?: number;
  dbname?: string;
  username?: string;
  password?: string;
};

export async function createDatabase(input: CreateDatabaseInput, actor = "system") {
  const name = slugify(input.name);
  const engine = ENGINES.find((e) => e.id === input.engine);
  if (!engine) throw new Error(`Unknown engine ${input.engine}`);
  if (await one("SELECT id FROM db_services WHERE name = ?", [name])) {
    throw new Error(`A database named "${name}" already exists.`);
  }

  const username = (input.username || "caagil").replace(/[^a-zA-Z0-9_]/g, "");
  const password = input.password || shortPassword(24);
  const publicPort = input.publicPort || 33000 + Math.floor(Math.random() * 2000);
  const now = Date.now();
  const id = randomId("db");

  await ensureNetwork();
  await execute(
    `INSERT INTO db_services (id, name, engine, version, port, public_port, username, password, dbname, volume, remote, status, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id,
      name,
      engine.id,
      input.version || engine.versions[0],
      engine.port,
      input.remote ? publicPort : null,
      username,
      password,
      (input.dbname || name).replace(/[^a-zA-Z0-9_]/g, "_"),
      `caagil-db-${name}`,
      input.remote ? 1 : 0,
      "created",
      now,
    ],
  );

  const db = (await getDatabase(id))!;
  try {
    await applyDatabase(db);
  } catch (err) {
    // Roll back so a failed create does not leave a ghost database behind.
    await removeContainerSafe(null, `db-${name}`);
    await execute("DELETE FROM db_services WHERE id = ?", [id]);
    await logActivity("db.create", `${name}: ${err instanceof Error ? err.message : err}`, actor, false);
    throw err;
  }

  await logActivity(
    "db.create",
    `${engine.label} ${name}${input.remote ? ` exposed on :${publicPort}` : ""}`,
    actor,
  );
  return (await getDatabase(id))!;
}

export async function databaseAction(
  id: string,
  action: "delete" | "start" | "stop" | "restart" | "expose" | "unexpose",
  actor = "system",
  publicPort?: number,
) {
  const db = await getDatabase(id);
  if (!db) throw new Error("Database not found");

  if (action === "delete") {
    await removeContainerSafe(db.container_id, `db-${db.name}`);
    try {
      await docker.getVolume(db.volume!).remove();
    } catch {
      /* volume in use or missing */
    }
    await execute("DELETE FROM db_services WHERE id = ?", [db.id]);
    await logActivity("db.delete", db.name, actor);
    return { deleted: true };
  }

  if (action === "expose") {
    const port = publicPort || db.public_port || 33000 + Math.floor(Math.random() * 2000);
    await execute("UPDATE db_services SET remote = 1, public_port = ? WHERE id = ?", [port, db.id]);
    await applyDatabase({ ...db, remote: 1, public_port: port });
    await logActivity("db.expose", `${db.name} on :${port}`, actor);
    return { ok: true, publicPort: port };
  }

  if (action === "unexpose") {
    await execute("UPDATE db_services SET remote = 0 WHERE id = ?", [db.id]);
    await applyDatabase({ ...db, remote: 0 });
    await logActivity("db.unexpose", db.name, actor);
    return { ok: true };
  }

  if (!db.container_id) throw new Error("Database container is missing.");
  const container = docker.getContainer(db.container_id);
  if (action === "start") {
    await container.start().catch(() => {});
    await execute("UPDATE db_services SET status = 'running' WHERE id = ?", [db.id]);
  }
  if (action === "stop") {
    await container.stop({ t: 10 }).catch(() => {});
    await execute("UPDATE db_services SET status = 'stopped' WHERE id = ?", [db.id]);
  }
  if (action === "restart") {
    await container.restart({ t: 10 }).catch(() => container.start());
    await execute("UPDATE db_services SET status = 'running' WHERE id = ?", [db.id]);
  }
  await logActivity(`db.${action}`, db.name, actor);
  return { ok: true };
}

/* ─────────────────────── external mysql targets ─────────────────── */

export async function listTargets(): Promise<TargetRow[]> {
  return query<TargetRow[]>("SELECT * FROM targets ORDER BY created_at DESC");
}

export async function addTarget(
  input: { name: string; host: string; port?: number; username: string; password?: string; ssl?: boolean },
  actor = "system",
) {
  const id = randomId("tgt");
  await execute(
    "INSERT INTO targets(id, name, host, port, username, password, use_tls, created_at) VALUES(?,?,?,?,?,?,?,?)",
    [id, input.name, input.host, input.port || 3306, input.username, input.password || null, input.ssl ? 1 : 0, Date.now()],
  );
  await logActivity("target.add", `${input.name} → ${input.host}:${input.port || 3306}`, actor);
  return one<TargetRow>("SELECT * FROM targets WHERE id = ?", [id]);
}

export async function removeTarget(id: string, actor = "system") {
  await execute("DELETE FROM targets WHERE id = ?", [id]);
  await logActivity("target.remove", id, actor);
  return { deleted: true };
}

async function targetConnection(target: TargetRow) {
  return mysql.createConnection({
    host: target.host,
    port: Number(target.port),
    user: target.username,
    password: target.password || "",
    connectTimeout: 8000,
    ssl: target.use_tls ? { rejectUnauthorized: false } : undefined,
  });
}

export async function testTarget(id: string) {
  const target = await one<TargetRow>("SELECT * FROM targets WHERE id = ?", [id]);
  if (!target) throw new Error("Target not found");
  const conn = await targetConnection(target);
  try {
    const [rows] = await conn.query("SELECT VERSION() AS version, DATABASE() AS db");
    const [dbs] = await conn.query("SHOW DATABASES");
    return {
      ok: true,
      version: (rows as Record<string, unknown>[])[0]?.version,
      databases: (dbs as Record<string, unknown>[]).map((r) => Object.values(r)[0]),
    };
  } finally {
    await conn.end();
  }
}

const READ_ONLY = /^\s*(select|show|describe|desc|explain)\b/i;

export async function targetQuery(id: string, sql: string) {
  if (!READ_ONLY.test(sql)) throw new Error("Only read-only queries (SELECT/SHOW/DESCRIBE/EXPLAIN) are allowed.");
  const target = await one<TargetRow>("SELECT * FROM targets WHERE id = ?", [id]);
  if (!target) throw new Error("Target not found");
  const conn = await targetConnection(target);
  try {
    const [rows] = await conn.query({ sql, rowsAsArray: false });
    const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
    return { rows: list.slice(0, 200), truncated: list.length > 200 };
  } finally {
    await conn.end();
  }
}

/* ───────────────────────────── domains ─────────────────────────── */

export async function listDomains() {
  return query<
    { id: string; host: string; app_id: string | null; app_name: string | null; cert: string; created_at: number }[]
  >(
    `SELECT d.id, d.host, d.app_id, a.name AS app_name, d.cert, d.created_at
       FROM domains d LEFT JOIN apps a ON a.id = d.app_id
      ORDER BY d.created_at DESC`,
  );
}

export async function addDomain(host: string, appId: string, actor = "system") {
  const clean = host.toLowerCase().trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) throw new Error("That does not look like a hostname.");
  const app = await getApp(appId);
  if (!app) throw new Error("App not found");

  const existing = await one<{ app_id: string }>("SELECT app_id FROM domains WHERE host = ?", [clean]);
  if (existing) throw new Error(`${clean} is already assigned to another app.`);

  await execute("INSERT INTO domains(id, host, app_id, cert, created_at) VALUES(?,?,?,?,?)", [
    randomId("dom"),
    clean,
    app.id,
    "letsencrypt",
    Date.now(),
  ]);
  await applyApp(app);
  await logActivity("domain.add", `${clean} → ${app.name}`, actor);
  return listDomains();
}

export async function removeDomain(id: string, actor = "system") {
  const row = await one<{ app_id: string | null; host: string }>(
    "SELECT app_id, host FROM domains WHERE id = ?",
    [id],
  );
  if (!row) throw new Error("Domain not found");
  await execute("DELETE FROM domains WHERE id = ?", [id]);
  if (row.app_id) {
    const app = await getApp(row.app_id);
    if (app) {
      if (app.domain === row.host) {
        await execute("UPDATE apps SET domain = NULL WHERE id = ?", [app.id]);
      }
      await applyApp((await getApp(app.id))!);
    }
  }
  await logActivity("domain.remove", row.host, actor);
  return listDomains();
}

/* ──────────────────────── panel access / edge ──────────────────── */

export type PanelAccessInput = {
  /** New panel hostname; empty string removes the domain (IP access only). */
  domain?: string;
  /** Turn plain-HTTP access by public IP on or off. */
  allowIp?: boolean;
  /** Public IP used for the IP router. Auto-detected when omitted. */
  ip?: string;
};

/**
 * Change where the panel is served: hostname, IP access, or both.
 * Writes the Traefik file-provider config, then persists settings and moves
 * existing path routes that were mounted on the old panel domain.
 */
export async function savePanelAccess(input: PanelAccessInput, actor = "system") {
  const current = await panelEdgeSettings();
  const next = { ...current };

  if (input.domain !== undefined) {
    const trimmed = input.domain.trim();
    next.domain = trimmed ? normalizeDomain(trimmed) : null;
  }

  if (input.ip !== undefined) {
    const trimmed = input.ip.trim();
    next.ip = trimmed || null;
  }

  if (input.allowIp !== undefined) next.allowIp = Boolean(input.allowIp);

  const unchanged =
    next.domain === current.domain && next.allowIp === current.allowIp && next.ip === current.ip;
  if (unchanged) {
    return {
      domain: next.domain,
      url: next.domain
        ? `https://${next.domain}`
        : next.allowIp && next.ip
          ? `http://${next.ip}`
          : "",
      allowIp: next.allowIp,
      ip: next.ip,
      movedRoutes: 0,
    };
  }

  if (next.allowIp && !next.ip) next.ip = await detectPublicIp();
  if (next.allowIp && !next.ip) {
    throw new Error("Could not detect the public IP. Enter it manually and try again.");
  }
  if (next.allowIp && next.ip && !isIpAddress(next.ip)) {
    throw new Error("IP access needs a valid IPv4 address in the public IP field.");
  }
  if (!next.domain && !(next.allowIp && next.ip)) {
    throw new Error("Keep a domain or enable IP access — otherwise the panel becomes unreachable.");
  }

  if (next.domain && next.domain !== current.domain) {
    // The panel wins Host-only matching via priority 150, so an app may share
    // the hostname only when it is mounted under a path (priority 200).
    const clash = await one<{ name: string; path_prefix: string | null }>(
      "SELECT name, path_prefix FROM apps WHERE LOWER(domain) = ? LIMIT 1",
      [next.domain],
    );
    if (clash && !clash.path_prefix) {
      throw new Error(`${next.domain} is the primary domain of app "${clash.name}". Move that app first.`);
    }
    const dom = await one<{ name: string; path_prefix: string | null }>(
      "SELECT a.name, a.path_prefix FROM domains d JOIN apps a ON a.id = d.app_id WHERE d.host = ? LIMIT 1",
      [next.domain],
    );
    if (dom && !dom.path_prefix) {
      throw new Error(`${next.domain} is attached to app "${dom.name}". Remove it there first.`);
    }
  }

  try {
    await writePanelEdge(next);
  } catch (err) {
    throw new Error(
      `Could not write the edge config (${EDGE_DIR}). Check that the panel can write there: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  await setSetting("panel_domain", next.domain ?? "");
  await setSetting("public_ip", next.ip ?? "");
  await setSetting("allow_ip_access", next.allowIp ? "1" : "0");

  const moved =
    current.domain && next.domain && current.domain !== next.domain
      ? await query<AppRow[]>("SELECT * FROM apps WHERE path_host = ?", [current.domain])
      : [];

  if (moved.length && next.domain) {
    await execute("UPDATE apps SET path_host = ? WHERE path_host = ?", [next.domain, current.domain]);
    for (const app of moved) {
      await applyApp((await getApp(app.id))!).catch(() => {});
    }
  }

  await logActivity(
    "settings.access",
    `panel → ${next.domain ? `https://${next.domain}` : ""}${
      next.allowIp && next.ip ? ` + http://${next.ip}` : ""
    }`,
    actor,
  );

  return {
    domain: next.domain,
    url: next.domain ? `https://${next.domain}` : next.allowIp && next.ip ? `http://${next.ip}` : "",
    allowIp: next.allowIp,
    ip: next.ip,
    movedRoutes: moved.length,
  };
}

/* ──────────────────────────── overview ─────────────────────────── */

export async function overview() {
  const [appRows, wpDbs, databases, domains, targets, activity, stats, publicIp, edge] =
    await Promise.all([
      listApps(),
      query<AppDbRow[]>("SELECT * FROM app_databases"),
      listDatabases(),
      listDomains(),
      listTargets(),
      query<{ id: number; ts: number; actor: string; action: string; detail: string; ok: number }[]>(
        "SELECT * FROM activity ORDER BY id DESC LIMIT 25",
      ),
      systemStats(),
      getSetting("public_ip"),
      panelEdgeSettings(),
    ]);

  const apps = appRows.map((app) => ({
    ...app,
    wp_db: wpDbs.find((db) => db.app_id === app.id) ?? null,
  }));

  return {
    apps,
    databases,
    domains,
    targets,
    activity,
    stats,
    publicIp,
    panel: {
      name: (await getSetting("panel_name")) || "Caagil",
      domain: edge.domain,
      allowIp: edge.allowIp,
      ip: edge.ip,
      url: edge.domain
        ? `https://${edge.domain}`
        : edge.allowIp && edge.ip
          ? `http://${edge.ip}`
          : process.env.PANEL_URL || "",
    },
  };
}
