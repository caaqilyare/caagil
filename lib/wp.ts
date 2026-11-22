/**
 * WordPress provisioning: managed per-app MySQL databases on the panel's own
 * MySQL server, plus wp-cli driven installs ("Softaculous"-style one-click).
 */
import { PassThrough } from "node:stream";
import type { Readable } from "node:stream";
import fs from "node:fs/promises";
import path from "node:path";
import Docker from "dockerode";
import { containerLogs, docker, HOST_SITES_DIR, NETWORK, pullIfMissing } from "./docker";
import { randomId, shortPassword } from "./crypto";

const WP_CLI_IMAGE = "wordpress:cli";
export const MYSQL_HOST = "mysql:3306";

/** PHP snippet appended to wp-config.php so HTTPS is detected behind Traefik. */
export const WP_PROXY_HTTPS =
  "if (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strpos($_SERVER['HTTP_X_FORWARDED_PROTO'], 'https') !== false) { $_SERVER['HTTPS'] = 'on'; }";

/** Rewrites $_SERVER['REQUEST_URI'] so WordPress keeps the public path prefix
 * behind a stripped path route (e.g. /blog → REQUEST_URI /blog/wp-admin/…). */
export function wpPrefixSnippet(prefix: string): string {
  const p = prefix.startsWith("/") ? prefix : `/${prefix}`;
  return (
    `if (isset($_SERVER['HTTP_X_FORWARDED_PREFIX']) && strpos($_SERVER['HTTP_X_FORWARDED_PREFIX'], '${p}') === 0) {` +
    ` $_SERVER['REQUEST_URI'] = $_SERVER['HTTP_X_FORWARDED_PREFIX'] . $_SERVER['REQUEST_URI']; }`
  );
}

async function mysqlContainer() {
  const candidates = ["caagil-mysql-1", "caagil_mysql_1", "mysql"];
  for (const name of candidates) {
    try {
      const c = docker.getContainer(name);
      await c.inspect();
      return c;
    } catch {
      /* try next */
    }
  }
  const list = await docker.listContainers({ all: true });
  const hit = list.find(
    (c) =>
      c.Labels["com.docker.compose.service"] === "mysql" ||
      c.Names.some((n) => n.toLowerCase().includes("mysql")),
  );
  if (!hit) throw new Error("No MySQL server container found for managed databases.");
  return docker.getContainer(hit.Id);
}

async function execOutput(
  container: Docker.Container,
  cmd: string[],
): Promise<{ code: number; output: string }> {
  const exec = await container.exec({ Cmd: cmd, AttachStdout: true, AttachStderr: true });
  const stream = (await exec.start({ hijack: true, stdin: false })) as Readable;
  const out = new PassThrough();
  const err = new PassThrough();
  docker.modem.demuxStream(stream, out, err);
  const chunks: Buffer[] = [];
  out.on("data", (c: Buffer) => chunks.push(c));
  err.on("data", (c: Buffer) => chunks.push(c));
  await new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  const info = (await exec.inspect()) as { ExitCode?: number };
  return { code: info.ExitCode ?? 1, output: Buffer.concat(chunks).toString("utf8").trim() };
}

/** Run SQL against the panel MySQL server as root (password stays inside the container). */
export async function runMysqlSql(sql: string): Promise<string> {
  const container = await mysqlContainer();
  const b64 = Buffer.from(sql, "utf8").toString("base64");
  const { code, output } = await execOutput(container, [
    "sh",
    "-c",
    `printf %s ${b64} | base64 -d | mysql -uroot -p"$MYSQL_ROOT_PASSWORD"`,
  ]);
  if (code !== 0) throw new Error(output || `MySQL command failed (exit ${code})`);
  return output;
}

export type AppDbInfo = { name: string; username: string; password: string; host: string };

/** Create a dedicated database for an app on the panel MySQL server. */
export async function createAppDatabase(appName: string): Promise<{ name: string }> {
  const db = `wp_${appName.replace(/-/g, "_")}`.slice(0, 64);
  await runMysqlSql(
    `CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
  );
  return { name: db };
}

/** Create the matching user and grant it full rights on the app's database. */
export async function createAppDatabaseUser(
  appName: string,
  password?: string,
): Promise<{ username: string; password: string }> {
  const user = `wp_${appName.replace(/-/g, "_")}`.slice(0, 26);
  const pass = password || shortPassword(24);
  await runMysqlSql(
    `CREATE USER IF NOT EXISTS '${user}'@'%' IDENTIFIED BY '${pass}';` +
      `ALTER USER '${user}'@'%' IDENTIFIED BY '${pass}';` +
      `GRANT ALL PRIVILEGES ON \`wp_${appName.replace(/-/g, "_")}\`.* TO '${user}'@'%';` +
      `FLUSH PRIVILEGES;`,
  );
  return { username: user, password: pass };
}

/** Database + user in one call. */
export async function provisionAppDatabase(appName: string): Promise<AppDbInfo> {
  const { name } = await createAppDatabase(appName);
  const { username, password } = await createAppDatabaseUser(appName);
  return { name, username, password, host: MYSQL_HOST };
}

/** Drop a managed database and its user (used when an app is deleted). */
export async function dropAppDatabase(db: string, user: string): Promise<void> {
  await runMysqlSql(
    `DROP DATABASE IF EXISTS \`${db.replace(/`/g, "")}\`;` +
      `DROP USER IF EXISTS '${user.replace(/'/g, "")}'@'%';`,
  );
}

/** The public URL an app is served on, based on its domain or path route. */
export function siteUrlFor(app: {
  domain: string | null;
  path_host: string | null;
  path_prefix: string | null;
}): string | null {
  if (app.domain) return `https://${app.domain}`;
  if (app.path_prefix && app.path_host) return `https://${app.path_host}${app.path_prefix}`;
  return null;
}

async function restartAppContainer(containerId: string | null): Promise<void> {
  if (!containerId) return;
  try {
    const c = docker.getContainer(containerId);
    const info = await c.inspect();
    if (info.State?.Running) await c.restart();
  } catch {
    /* best effort — wp-config is re-read per request anyway */
  }
}

/** Ensure wp-config.php keeps the public path prefix for existing installs: ... */
async function ensureWpConfigPrefix(appName: string, prefix: string): Promise<void> {
  const wpConfig = path.join(HOST_SITES_DIR, appName, "wp-config.php");
  let cfg: string;
  try {
    cfg = await fs.readFile(wpConfig, "utf8");
  } catch {
    return; // no wp-config yet — the container entrypoint will write it from env
  }
  const marker = "HTTP_X_FORWARDED_PREFIX";
  if (cfg.includes(marker)) return; // already patched
  const snip = [
    `if (isset($_SERVER['HTTP_X_FORWARDED_PREFIX']) && strpos($_SERVER['HTTP_X_FORWARDED_PREFIX'], '${prefix}') === 0) {`,
    "\t$_SERVER['REQUEST_URI'] = $_SERVER['HTTP_X_FORWARDED_PREFIX'] . $_SERVER['REQUEST_URI'];",
    "}",
  ].join("\n");
  const oldBlock = `if ($configExtra = getenv_docker('WORDPRESS_CONFIG_EXTRA', '')) {\n\teval($configExtra);\n}`;
  const body = cfg.includes(oldBlock) ? cfg.replace(oldBlock, oldBlock + "\n" + snip) : cfg + "\n\n" + snip;
  await fs.writeFile(wpConfig, body);
}

export type WpInstallInput = {
  url?: string;
  title?: string;
  adminUser?: string;
  adminPassword?: string;
  adminEmail?: string;
};

const INSTALL_SCRIPT = `
i=0
while [ $i -lt 60 ] && [ ! -f wp-config.php ]; do sleep 2; i=$((i+1)); done
if [ ! -f wp-config.php ]; then echo "wp-config.php was never generated by the WordPress container"; exit 2; fi
i=0
err=""
while [ $i -lt 40 ]; do
  if wp core is-installed --allow-root --path=/var/www/html >/dev/null 2>&1; then
    echo "WordPress is already installed"
    exit 0
  fi
  if err=$(wp core install --allow-root --path=/var/www/html --url="$WP_URL" --title="$WP_TITLE" \\
       --admin_user="$WP_ADMIN" --admin_password="$WP_PASS" --admin_email="$WP_EMAIL" --skip-email 2>&1); then
    echo "WordPress installed at $WP_URL (admin user: $WP_ADMIN)"
    exit 0
  fi
  sleep 3
  i=$((i+1))
done
echo "\${err:-wp core install kept failing}"
exit 3
`;

/**
 * Finish a WordPress install inside the running app: wait for wp-config.php,
 * then run `wp core install` from a one-off wordpress:cli container sharing
 * the app's files. Creates tables, the site and the admin account.
 */
export async function installWordPress(
  app: {
    name: string;
    container_id: string | null;
    domain: string | null;
    path_host: string | null;
    path_prefix: string | null;
    env?: unknown;
  },
  input: WpInstallInput = {},
): Promise<{ url: string; adminUser: string }> {
  if (!app.container_id) throw new Error("The app has no running container — redeploy it first.");

  // wp-config.php resolves DB credentials from WORDPRESS_DB_* env at runtime,
  // so the one-off installer container needs the same env as the app.
  let appEnv: Record<string, unknown> = {};
  try {
    appEnv = typeof app.env === "string" ? JSON.parse(app.env || "{}") : (app.env ?? {});
  } catch {
    appEnv = {};
  }
  const dbEnv = [
    "WORDPRESS_DB_HOST",
    "WORDPRESS_DB_NAME",
    "WORDPRESS_DB_USER",
    "WORDPRESS_DB_PASSWORD",
    "WORDPRESS_TABLE_PREFIX",
  ]
    .filter((k) => appEnv[k])
    .map((k) => `${k}=${appEnv[k]}`);

  const url = (input.url?.trim() || siteUrlFor(app) || "").replace(/\/+$/, "");
  if (!url) {
    throw new Error(
      "No URL for this app yet. Attach a domain or path route first, then run WP install again.",
    );
  }

  // Older installs (and installs created before the X-Forwarded-Prefix fix)
  // keep a wp-config.php without the path-prefix snippet — patch it in so
  // wp-admin behind a path route keeps the prefix.
  const wpPrefix = app.path_prefix ? (app.path_prefix.startsWith("/") ? app.path_prefix : `/${app.path_prefix}`) : null;
  if (wpPrefix) {
    await ensureWpConfigPrefix(app.name, wpPrefix);
    await restartAppContainer(app.container_id);
  }
  const title = input.title?.trim() || app.name;
  const adminUser = (input.adminUser?.trim() || "admin").replace(/[^a-zA-Z0-9_.@-]/g, "") || "admin";
  const adminPassword = input.adminPassword?.trim() || shortPassword(16);
  let adminEmail = input.adminEmail?.trim() || "";
  if (!adminEmail || !adminEmail.includes("@")) {
    adminEmail = `admin@${new URL(url).hostname}`;
  }

  await pullIfMissing(WP_CLI_IMAGE);

  let container: Docker.Container;
  try {
    container = await docker.createContainer({
      name: `caagil-wpcli-${randomId()}`,
      Image: WP_CLI_IMAGE,
      Cmd: ["sh", "-c", INSTALL_SCRIPT],
      Env: [
        ...dbEnv,
        `WP_URL=${url}`,
        `WP_TITLE=${title}`,
        `WP_ADMIN=${adminUser}`,
        `WP_PASS=${adminPassword}`,
        `WP_EMAIL=${adminEmail}`,
        "HOME=/tmp",
      ],
      User: "0:0",
      WorkingDir: "/var/www/html",
      Labels: { "caagil.managed": "true" },
      HostConfig: {
        Binds: [`${HOST_SITES_DIR}/${app.name}:/var/www/html`],
        NetworkMode: NETWORK,
      },
    });
  } catch (err) {
    throw new Error(`Could not start the wp-cli installer: ${err instanceof Error ? err.message : err}`);
  }

  try {
    await container.start();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("WordPress install timed out")), 8 * 60 * 1000),
    );
    const status = (await Promise.race([container.wait(), timeout])) as {
      StatusCode: number;
    };
    if (status.StatusCode !== 0) {
      const logs = await containerLogs(container.id, 40).catch(() => "");
      throw new Error(logs || `wp-cli installer exited with code ${status.StatusCode}`);
    }
  } finally {
    await container.remove({ force: true }).catch(() => {});
  }

  return { url, adminUser };
}
