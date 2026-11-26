import fs from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";
import { execute, one, query, logActivity, getSetting, setSetting } from "./db";
import { randomId, shortPassword } from "./crypto";
import { ENGINES, findPreset, type RuntimePreset } from "./presets";
import { cloneOrPull } from "./git";
import {
  containerIp,
  containerLogs,
  containerName,
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
  ensureWpConfigPrefix,
  ensureWpPathRules,
  installWordPress,
  MYSQL_HOST,
  WP_PROXY_HTTPS,
  wpPrefixSnippet,
  type WpInstallInput,
} from "./wp";
import {
  detectPublicIp,
  EDGE_DIR,
  isIpAddress,
  normalizeDomain,
  panelEdgeSettings,
  refreshPanelEdge,
  writePanelEdge,
} from "./edge";
import { dnsPointsHere, expectedPublicIp, probeDomain } from "./ssl";

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
  const trimmed = input.trim().toLowerCase();
  const withSlash = trimmed && !trimmed.startsWith("/") ? `/${trimmed}` : trimmed;
  const path = withSlash.replace(/\/+$/, "");
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

/* ── Fresh-app runtime defaults ─────────────────────────────────────────── */

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

const LANDING_HTML = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
</head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#070b10;color:#dfe7f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;text-align:center;">
<div style="max-width:520px;padding:40px">
<h1 style="font-size:28px;margin:0 0 12px">${title}</h1>
<p style="color:#8b98a9;line-height:1.6">${body}</p>
</div>
</body>
</html>`;

const LANDING_PHP = `<?php
header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Your site is live</title>
</head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#070b10;color:#dfe7f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;text-align:center;">
<div style="max-width:520px;padding:40px">
<h1 style="font-size:28px;margin:0 0 12px">Your site is live</h1>
<p style="color:#8b98a9;line-height:1.6">Welcome to your new app. Replace this page by dropping your files into the panel file manager.</p>
</div>
</body>
</html>`;

/** Landing placeholders so a fresh app (no git) answers immediately instead of 403. */
async function ensureFreshRuntime(appName: string, preset: RuntimePreset, port: number): Promise<void> {
  const dir = path.join(SITES_DIR, appName);
  await fs.mkdir(dir, { recursive: true });
  if (preset.group === "static") {
    const idx = path.join(dir, "index.html");
    if (await fileExists(idx)) return;
    await fs.writeFile(idx, LANDING_HTML("Your site is live", "This page will be replaced by your own files."));
  } else if (preset.group === "php") {
    const idx = path.join(dir, "index.php");
    if (await fileExists(idx)) return;
    await fs.writeFile(idx, LANDING_PHP);
  } else if (preset.group === "node") {
    const pkg = path.join(dir, "package.json");
    const srv = path.join(dir, "index.js");
    if (await fileExists(pkg)) return;
    await fs.writeFile(
      pkg,
      JSON.stringify(
        { name: appName, version: "0.0.0", private: true, scripts: { start: "node index.js" }, dependencies: {} },
        null,
        2,
      ),
    );
    await fs.writeFile(
      srv,
      [
        "const http = require('http');",
        `const port = Number(process.env.PORT || ${port});`,
        "const server = http.createServer((req, res) => {",
        "  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });",
        "  res.end('<!doctype html><html><body style=\\\"margin:0;min-height:100vh;display:grid;place-items:center;background:#070b10;color:#dfe7f1;font-family:sans-serif;text-align:center\\\">Your node app is live. Drop your code in the panel file manager.</body></html>');",
        "});",
        "server.listen(port, '0.0.0.0', () => console.log('listening on ' + port));",
        "",
      ].join("\n"),
    );
  }
}

/** Laravel-style repos keep the real entry point in <dir>/public — rewrite /. */
async function writeLaravelRewrite(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, "public"), { recursive: true });
  const pubIndex = path.join(dir, "public", "index.php");
  if (!(await fileExists(pubIndex))) return;
  const ht = path.join(dir, ".htaccess");
  if (await fileExists(ht)) return; // the repository ships its own rules
  await fs.writeFile(
    ht,
    [
      "<IfModule mod_rewrite.c>",
      "RewriteEngine On",
      "RewriteBase /",
      "RewriteRule ^(.*)$ public/$1 [L]",
      "</IfModule>",
      "",
    ].join("\n"),
  );
}

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

  // Path route (explicit, or a default /<name> route for WordPress) must be
  // resolved BEFORE the WordPress env block so a fresh app gets the prefix
  // snippet in WORDPRESS_CONFIG_EXTRA from its very first request.
  let pathPrefix = input.pathPrefix ? normalizePath(input.pathPrefix) : null;
  let pathHost = input.pathHost?.trim().toLowerCase() || null;
  if (pathPrefix && !pathHost) pathHost = await defaultRouteHost();

  const isWp = preset.id === "wordpress" || /wordpress/i.test(image);
  const autoWp = isWp && input.wp?.autoInstall !== false;
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

  // Plain Apache presets serving a Laravel-style repository: point the
  // document root at <dir>/public so the framework's real entry point works.
  let command = input.command ?? preset.command ?? null;
  if (!command && preset.group === "php") {
    if (await fileExists(path.join(SITES_DIR, name, "public", "index.php"))) {
      command =
        "a2enmod rewrite >/dev/null 2>&1; sed -i 's#</VirtualHost>#  <Directory /var/www/html/public>\n    AllowOverride All\n    Require all granted\n  </Directory>\n  DocumentRoot /var/www/html/public\n</VirtualHost>#' /etc/apache2/sites-available/000-default.conf; apache2-foreground";
    }
  }

  // Fresh apps (no git) get a landing placeholder so they answer instead of
  // 403ing; Laravel-style clones get the /public rewrite.
  if (input.gitUrl) {
    if (preset.group === "php" || preset.id === "laravel") {
      // Laravel-style repos keep the real entry point in <dir>/public.
      await writeLaravelRewrite(path.join(SITES_DIR, name));
    }
  } else if (preset.group === "node") {
    await ensureFreshRuntime(name, preset, port);
  } else if (preset.group === "php" || preset.group === "static") {
    await ensureFreshRuntime(name, preset, port);
  }

  // WordPress one-click: a managed database on the panel MySQL server plus
  // reverse-proxy HTTPS detection — unless the user wired their own DB env.
  let wpDb: { name: string; username: string; password: string; host: string } | null = null;
  if (isWp) {
    // HTTPS + path-prefix aware wp-config.php snippet (appended to whatever
    // custom config the user wired through the env textarea).
    let extra = env.WORDPRESS_CONFIG_EXTRA && env.WORDPRESS_CONFIG_EXTRA.trim() ? env.WORDPRESS_CONFIG_EXTRA : WP_PROXY_HTTPS;
    if (pathPrefix && !extra.includes("HTTP_X_FORWARDED_PREFIX")) {
      extra += "\n" + wpPrefixSnippet();
    }
    env.WORDPRESS_CONFIG_EXTRA = extra;
    if (!env.WORDPRESS_DB_HOST) {
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
      command,
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
  report?.("container", "done", containerName(name));

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
      const synced = await syncWpPrefixEnv((await getApp(app.id))!);
      if (synced.changed) await applyApp(synced.app);
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

/**
 * Keep a WordPress app's path prefix alive: inject the generic
 * X-Forwarded-Prefix snippet into WORDPRESS_CONFIG_EXTRA (used by the
 * container entrypoint's wp-config eval block) and clean/patch wp-config.php
 * for static configs. Runs on route changes, redeploys and WP installs so an
 * app mounted at /blog (or /munasar) keeps the prefix in wp-admin.
 */
async function syncWpPrefixEnv(app: AppRow): Promise<{ app: AppRow; changed: boolean }> {
  const isWp = /wordpress/i.test(`${app.runtime} ${app.image}`);
  if (!isWp) return { app, changed: false };

  const env = { ...parseEnv(app.env) };
  const extra = (env.WORDPRESS_CONFIG_EXTRA ?? "").trim() || WP_PROXY_HTTPS;
  // Upgrade the old hardcoded-prefix snippet to the generic header-driven one
  // (older versions pinned the route, so a later route change stopped working).
  const hasGeneric = extra.includes("!empty($_SERVER['HTTP_X_FORWARDED_PREFIX'])");
  const legacyLines = extra.includes("HTTP_X_FORWARDED_PREFIX")
    ? extra
        .split("\n")
        .filter((line) => !line.includes("HTTP_X_FORWARDED_PREFIX"))
        .join("\n")
        .trim() || WP_PROXY_HTTPS
    : extra;
  const needsSnippet = Boolean(app.path_prefix) && !hasGeneric;

  let changed = false;
  if (needsSnippet) {
    env.WORDPRESS_CONFIG_EXTRA = `${legacyLines}\n${wpPrefixSnippet()}`;
    await execute("UPDATE apps SET env = ?, updated_at = ? WHERE id = ?", [
      JSON.stringify(env),
      Date.now(),
      app.id,
    ]);
    changed = true;
  }
  if (app.path_prefix) await ensureWpConfigPrefix(app.name);
  if (app.path_prefix) await ensureWpPathRules(app);

  return { app: changed ? (await getApp(app.id))! : app, changed };
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
  const synced = await syncWpPrefixEnv((await getApp(app.id))!);
  await applyApp(synced.app);
  await logActivity("app.route", `${app.name} → ${host ?? "-"}${path ?? ""}`, actor);
  return (await getApp(app.id))!;
}

export async function redeployApp(id: string, actor = "system") {
  const initial = await getApp(id);
  if (!initial) throw new Error("App not found");
  if (initial.git_url) await cloneOrPull(initial.git_url, initial.branch, initial.name);
  const { app } = await syncWpPrefixEnv(initial);
  await applyApp(app);
  await logActivity("app.redeploy", app.name, actor);
  return (await getApp(id))!;
}

/** Replace an app's environment (used to push runtime fixes such as the
 * WordPress path-prefix snippet into running containers). */
export async function setAppEnv(
  id: string,
  env: Record<string, string>,
  actor = "system",
): Promise<AppRow> {
  const app = await getApp(id);
  if (!app) throw new Error("App not found");
  await execute("UPDATE apps SET env = ? WHERE id = ?", [JSON.stringify(env), app.id]);
  await applyApp(app);
  await logActivity("app.env", app.name, actor);
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
  const synced = await syncWpPrefixEnv(app);
  if (synced.changed) await applyApp(synced.app);
  const fresh = (await getApp(app.id))!;
  const res = await installWordPress(fresh, input);
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
  const user = db.username || "caaqil";
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
    const user = (db.username || "caaqil").replace(/'/g, "");
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

  // Rows created before the rename keep their caagil-db-* volume/container
  // name, so the existing data volume is reused instead of a fresh one.
  const tag = db.volume || `caaqil-db-${db.name}`;

  const existing = docker.getContainer(tag);
  await existing
    .inspect()
    .then(async () => {
      await existing.stop({ t: 5 }).catch(() => {});
      await existing.remove({ force: true });
    })
    .catch(() => {});

  const container = await docker.createContainer({
    name: tag,
    Image: image,
    Cmd: command ? ["sh", "-lc", command] : undefined,
    Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
    Labels: { "caaqil.managed": "true", "caaqil.kind": "database" },
    HostConfig: {
      RestartPolicy: { Name: "unless-stopped" },
      Binds: [`${tag}:${db.engine === "mongo" ? "/data/db" : db.engine === "postgres" ? "/var/lib/postgresql/data" : db.engine === "redis" ? "/data" : "/var/lib/mysql"}`],
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

  const username = (input.username || "caaqil").replace(/[^a-zA-Z0-9_]/g, "");
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
      `caaqil-db-${name}`,
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
    // Drop the optional MongoDB studio and its stored basic-auth credentials.
    try {
      const { removeMongoStudio } = await import("./mongo-studio");
      await removeMongoStudio(db.name);
    } catch {
      /* studio is optional; deleting the database must always succeed */
    }
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
  // SSL is requested by Traefik right away; watch until it actually lands.
  watchCertificate(clean, actor);
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

/* ──────────────────────────── SSL (cPanel-style) ─────────────────────────── */

export type DomainSsl = {
  host: string;
  scope: "panel" | "app";
  appName?: string | null;
  ok: boolean;
  issuer?: string;
  expiresAt?: number;
  selfSigned?: boolean;
  reason?: string;
};

/** Live SSL state for every known hostname (panel domain + attached domains). */
export async function sslStatus(): Promise<{ checkedAt: number; domains: DomainSsl[] }> {
  const [rows, edge] = await Promise.all([listDomains(), panelEdgeSettings()]);
  const entries: { host: string; scope: "panel" | "app"; appName?: string | null }[] = [];
  if (edge.domain) entries.push({ host: edge.domain, scope: "panel" });
  for (const row of rows) {
    if (row.host === edge.domain) continue;
    entries.push({ host: row.host, scope: "app", appName: row.app_name });
  }

  const probes = await Promise.all(
    entries.map(async (entry) => ({ entry, probe: await probeDomain(entry.host) })),
  );

  return {
    checkedAt: Date.now(),
    domains: probes.map(({ entry, probe }) => ({
      host: entry.host,
      scope: entry.scope,
      appName: entry.appName ?? null,
      ok: probe.ok,
      issuer: probe.issuer,
      expiresAt: probe.expiresAt,
      selfSigned: probe.selfSigned,
      reason: probe.reason,
    })),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll the live probe until a real certificate lands (or time out). */
async function waitForCertificate(
  domain: string,
  timeoutMs = 150_000,
): Promise<{ ok: boolean; issuer?: string; expiresAt?: number; reason?: string }> {
  const deadline = Date.now() + timeoutMs;
  let last: Awaited<ReturnType<typeof probeDomain>> | null = null;
  while (Date.now() < deadline) {
    last = await probeDomain(domain);
    if (last.ok) return last;
    await sleep(5000);
  }
  return { ok: false, reason: last?.reason || "no certificate appeared in time" };
}

/**
 * Force a Let's Encrypt certificate for a domain: nudge the matching Traefik
 * router (file config for the panel, container recreation for app domains),
 * then wait until the certificate is actually served.
 */
export async function startSslIssue(domain: string, actor = "system"): Promise<{ job: string }> {
  const clean = normalizeDomain(domain);
  const edge = await panelEdgeSettings();
  const isPanel = edge.domain === clean;
  const attached = await one<{ id: string; name: string }>(
    "SELECT a.id, a.name FROM domains d JOIN apps a ON a.id = d.app_id WHERE d.host = ? LIMIT 1",
    [clean],
  );
  if (!isPanel && !attached) {
    throw new Error(`${clean} is not attached to the panel or to any app.`);
  }

  const jobId = createJob("ssl.add", `SSL certificate · ${clean}`, [
    { key: "dns", label: "Checking DNS" },
    { key: "route", label: "Refreshing the HTTPS route" },
    { key: "acme", label: "Requesting the Let's Encrypt certificate" },
    { key: "verify", label: "Verifying HTTPS" },
  ]);

  void (async () => {
    try {
      jobStep(jobId, "dns", "active");
      const expected = await expectedPublicIp();
      const dns = await dnsPointsHere(clean, expected);
      if (!dns.resolved) {
        jobFail(
          jobId,
          `${clean} does not resolve in DNS yet. Add an A record → ${expected ?? "this server's IP"} first.`,
        );
        return;
      }
      if (dns.ok) {
        jobStep(jobId, "dns", "done", `A → ${dns.expected}`);
      } else {
        // A CDN/proxy (e.g. Cloudflare) may sit in front — try anyway, the
        // certificate request only needs HTTP-01 traffic to reach Traefik.
        jobStep(jobId, "dns", "done", `resolves to ${dns.found[0]} (proxy?) — trying anyway`);
      }

      jobStep(jobId, "route", "active");
      if (isPanel) {
        await refreshPanelEdge();
      } else {
        await applyApp((await getApp(attached!.id))!);
      }
      jobStep(jobId, "route", "done");

      jobStep(jobId, "acme", "active", "usually 10-30 seconds…");
      const cert = await waitForCertificate(clean);
      if (!cert.ok) {
        jobFail(jobId, `Let's Encrypt did not issue a certificate: ${cert.reason}`);
        await logActivity("ssl.add", `${clean}: ${cert.reason}`, actor, false);
        return;
      }
      jobStep(jobId, "acme", "done", cert.issuer || "Let's Encrypt");

      jobStep(jobId, "verify", "active");
      jobStep(
        jobId,
        "verify",
        "done",
        `valid until ${new Date(cert.expiresAt ?? Date.now() + 90 * 86400_000).toISOString().slice(0, 10)}`,
      );
      await logActivity("ssl.add", `${clean}: certificate live (${cert.issuer ?? "Let's Encrypt"})`, actor);
      jobFinish(jobId, { domain: clean, issuer: cert.issuer, expiresAt: cert.expiresAt });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logActivity("ssl.add", `${clean}: ${msg}`, actor, false).catch(() => {});
      jobFail(jobId, msg);
    }
  })();

  return { job: jobId };
}

/**
 * After a domain is attached, watch in the background until Let's Encrypt
 * serves a real certificate and log the outcome.
 */
function watchCertificate(host: string, actor: string, timeoutMs = 180_000): void {
  void (async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(10_000);
      const probe = await probeDomain(host).catch(() => null);
      if (probe?.ok) {
        await logActivity("ssl.add", `${host}: certificate live (${probe.issuer ?? "Let's Encrypt"})`, actor);
        return;
      }
    }
    await logActivity(
      "ssl.add",
      `${host}: no certificate after 3 minutes — check the DNS A record, then press "Add SSL"`,
      actor,
      false,
    );
  })();
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

  // phpMyAdmin's Traefik labels embed the panel host — recreate when it moved.
  if (current.domain !== next.domain || current.ip !== next.ip) {
    try {
      const { refreshPmaIfRunning } = await import("./pma");
      await refreshPmaIfRunning();
    } catch {
      /* phpMyAdmin is optional; access changes must never fail because of it */
    }
    try {
      const { refreshMongoStudiosIfRunning } = await import("./mongo-studio");
      await refreshMongoStudiosIfRunning();
    } catch {
      /* MongoDB Studio is optional too */
    }
  }

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
      name: (await getSetting("panel_name")) || "Caaqil",
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
