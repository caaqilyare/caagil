/**
 * phpMyAdmin integration for the panel's own MySQL server.
 *
 * Architecture (secure, no credentials in URLs, no root exposure):
 *  - The panel manages a `phpmyadmin:5.2-apache` container on the panel
 *    network, routed through Traefik at <panel-host>/pma (StripPrefix).
 *  - phpMyAdmin runs with auth_type=signon and a signon bridge script the
 *    panel mounts into the container.
 *  - "Open phpMyAdmin" creates a short-lived (60s) single-use token; the
 *    panel redirects the browser to the signon bridge, which exchanges the
 *    token server-to-server (shared internal secret) for limited MySQL
 *    credentials and starts the phpMyAdmin session.
 *  - The MySQL user the bridge receives (caaqil_pma) has grants only on
 *    managed app databases (wp_% pattern) — never global, never root.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execute, one, getSetting, setSetting, logActivity } from "./db";
import { randomToken, encryptSecret, decryptSecret, safeEqual } from "./crypto";
import { DATA_DIR, HOST_DATA_DIR, docker, pullIfMissing, removeContainerSafe, runContainer, traefikLabels } from "./docker";
import { panelEdgeSettings } from "./edge";
import { ensurePmaUser, pmaCredentials } from "./mysqladmin";

export const PMA_IMAGE = "phpmyadmin:5.2-apache";
export const PMA_CONTAINER = "caaqil-phpmyadmin";
export const PMA_TOKEN_TTL_MS = 60 * 1000;
export const PMA_PATH = "/pma";
const PMA_DIR = path.join(DATA_DIR, "pma");
/** Host-side paths: bind sources are resolved by the Docker daemon, not by us. */
const PMA_HOST_DIR = path.join(HOST_DATA_DIR, "pma");
const CONFIG_FILE = path.join(PMA_DIR, "config.user.inc.php");
const SIGNON_FILE = path.join(PMA_DIR, "signon-caaqil.php");
const HOST_CONFIG_FILE = path.join(PMA_HOST_DIR, "config.user.inc.php");
const HOST_SIGNON_FILE = path.join(PMA_HOST_DIR, "signon-caaqil.php");

export type PmaStatus = {
  installed: boolean;
  running: boolean;
  url: string | null;
  host: string | null;
  error?: string;
};

function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function internalSecret(): Promise<string> {
  const existing = await getSetting("pma_internal_secret");
  if (existing) return existing;
  const secret = randomToken(32);
  await setSetting("pma_internal_secret", encryptSecret(secret));
  return secret;
}

/* ───────────────────────────── asset generation ───────────────────────────── */

/** The base URL the PMA app is reachable under (accounts for IP-only mode). */
export async function pmaBaseUrl(): Promise<string | null> {
  const edge = await panelEdgeSettings();
  if (edge.domain) return `https://${edge.domain}${PMA_PATH}`;
  if (edge.allowIp && edge.ip) return `http://${edge.ip}${PMA_PATH}`;
  return null;
}

function renderConfigUserInc(baseUrl: string): string {
  return `<?php
/* Caaqil phpMyAdmin configuration — written by the panel, do not edit by hand. */
$cfg['auth_type'] = 'signon';
$cfg['PMA_Absolute_Uri'] = ${JSON.stringify(`${baseUrl}/`)};
$cfg['PmaAbsoluteUri'] = ${JSON.stringify(`${baseUrl}/`)};
$cfg['AllowArbitraryServer'] = false;
$cfg['AllowNoPassword'] = false;
$cfg['ZeroConf'] = false;
$cfg['DisplayErrors'] = false;
$cfg['AllowBreakpoint'] = false;
$cfg['MaxKeyLength'] = 64;
$cfg['CollationTables'] = 'utf8mb4_general_ci,utf8mb4_unicode_ci,utf8_general_ci,utf8_unicode_ci';

$cfg['Servers'][1]['host'] = 'mysql';
$cfg['Servers'][1]['port'] = 3306;
$cfg['Servers'][1]['auth_type'] = 'signon';
/* SignonSession/SignonURL are per-server settings — phpMyAdmin ignores the
   global form, which made every signon attempt fall back to a cookie login. */
$cfg['Servers'][1]['SignonSession'] = 'CaaqilSignon';
$cfg['Servers'][1]['SignonURL'] = ${JSON.stringify(`${baseUrl}/signon-caaqil.php`)};
$cfg['Servers'][1]['hide_db'] = '';
$cfg['Servers'][1]['only_db'] = '';
`;
}

function renderSignonScript(secret: string, baseUrl: string): string {
  // The panel rewrites these two values at launch; the bridge is regenerated
  // whenever the internal secret changes or the panel host changes.
  return `<?php
/*
 * Caaqil phpMyAdmin signon bridge.
 * Exchanges a single-use token for limited MySQL credentials and starts a
 * phpMyAdmin signon session. Credentials never appear in URLs or logs.
 */
$session_name = 'CaaqilSignon';
session_name($session_name);
/* Without an active session the credentials below are never persisted and
   phpMyAdmin always bounced back to its login form. */
session_start();

$t = isset($_GET['t']) ? rawurlencode($_GET['t']) : '';
if ($t === '') {
    header('Location: ${baseUrl}/');
    exit;
}

$secret = ${JSON.stringify(secret)};
$ctx = stream_context_create(['http' => ['method' => 'GET', 'timeout' => 8,
    'header' => "x-caaqil-internal: $secret\\r\\n"]]);
$body = @file_get_contents('http://panel:4000/api/pma/exchange?t=' . $t, false, $ctx);

if ($body === false) {
    http_response_code(502);
    echo 'phpMyAdmin could not reach the panel to complete sign-on.';
    exit;
}
$creds = json_decode($body, true);
if (!is_array($creds) || !($creds['ok'] ?? false)) {
    header('Location: ' . ${JSON.stringify(baseUrl)} . '/');
    exit;
}

$_SESSION['PMA_single_signon_user'] = $creds['user'];
$_SESSION['PMA_single_signon_password'] = $creds['password'];
$_SESSION['PMA_single_signon_host'] = $creds['host'];
$_SESSION['PMA_single_signon_port'] = $creds['port'];
session_write_close();

header('Location: ${baseUrl}/index.php?server=1');
exit;
`;
}

/** Write the mounted assets (config + signon bridge) with the current host. */
export async function writePmaAssets(): Promise<void> {
  const baseUrl = await pmaBaseUrl();
  if (!baseUrl) {
    throw new Error("phpMyAdmin needs a panel domain or IP access before it can be started.");
  }
  const secret = await internalSecret();
  await fs.mkdir(PMA_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, renderConfigUserInc(baseUrl), "utf8");
  await fs.writeFile(SIGNON_FILE, renderSignonScript(secret, baseUrl), "utf8");
}

/* ───────────────────────────── container lifecycle ───────────────────────────── */

export async function pmaStatus(): Promise<PmaStatus> {
  const url = await pmaBaseUrl();
  const list = await docker.listContainers({
    all: true,
    filters: { label: ["caaqil.kind=pma"] },
  });
  const hit = list.find((c) => c.Names.some((n) => n.endsWith(PMA_CONTAINER)));
  if (!hit) {
    return {
      installed: false,
      running: false,
      url,
      host: url ? new URL(url).host : null,
      error: "phpMyAdmin is not installed yet.",
    };
  }
  const info = await docker.getContainer(hit.Id).inspect().catch(() => null);
  if (!info) {
    return { installed: false, running: false, url, host: url ? new URL(url).host : null };
  }
  return {
    installed: true,
    running: info.State?.Running === true,
    url,
    host: url ? new URL(url).host : null,
    error:
      info.State?.Status === "exited"
        ? `phpMyAdmin container stopped (exit ${info.State?.ExitCode ?? 0}).`
        : undefined,
  };
}

/** Create or recreate the phpMyAdmin container with fresh assets. */
export async function ensurePmaContainer(actor = "system"): Promise<PmaStatus> {
  await ensurePmaUser();
  await writePmaAssets();

  const edge = await panelEdgeSettings();
  const host = edge.domain ?? (edge.allowIp && edge.ip ? edge.ip : null);
  if (!host) throw new Error("Set a panel domain or enable IP access in Settings before starting phpMyAdmin.");

  await removeContainerSafe(null, PMA_CONTAINER);
  await pullIfMissing(PMA_IMAGE);

  const container = await runContainer({
    name: PMA_CONTAINER,
    image: PMA_IMAGE,
    port: 80,
    env: {
      PMA_ARBITRARY: "0",
      PMA_SKIP_INSTALL: "1",
      PMA_ABSOLUTE_URI: `${await pmaBaseUrl()}/`,
    },
    binds: [
      `${HOST_CONFIG_FILE}:/etc/phpmyadmin/config.user.inc.php:ro`,
      `${HOST_SIGNON_FILE}:/var/www/html/signon-caaqil.php:ro`,
    ],
    labels: {
      ...traefikLabels("pma", [{ host, path: PMA_PATH, strip: true }], 80),
      "caaqil.kind": "pma",
    },
  });

  await logActivity("pma.start", `phpMyAdmin ${PMA_IMAGE}`, actor);
  return pmaStatus();
}

export async function stopPma(actor = "system"): Promise<PmaStatus> {
  await removeContainerSafe(null, PMA_CONTAINER);
  await logActivity("pma.stop", "phpMyAdmin container removed", actor);
  return pmaStatus();
}

/** Recreate PMA after a panel-host change (labels embed the hostname). */
export async function refreshPmaIfRunning(): Promise<void> {
  const status = await pmaStatus();
  if (status.installed) {
    await ensurePmaContainer("system").catch(() => {});
  }
}

/* ───────────────────────────── launch tokens ───────────────────────────── */

/** Create a single-use, short-lived launch token for this panel user. */
export async function createLaunchToken(userId: string): Promise<{ token: string; url: string }> {
  const baseUrl = await pmaBaseUrl();
  if (!baseUrl) throw new Error("phpMyAdmin needs a panel domain or IP access before it can be started.");
  const status = await pmaStatus();
  if (!status.installed || !status.running) {
    throw new Error("phpMyAdmin is not running — start it first.");
  }

  const token = randomToken(24);
  const now = Date.now();
  await execute("INSERT INTO pma_tokens(token_hash, user_id, expires_at, created_at) VALUES(?,?,?,?)", [
    tokenHash(token),
    userId,
    now + PMA_TOKEN_TTL_MS,
    now,
  ]);

  // One-time cleaning of stale tokens; heavy pruning is in the scheduler.
  await execute("DELETE FROM pma_tokens WHERE expires_at < ?", [now - PMA_TOKEN_TTL_MS]).catch(() => {});

  return { token, url: `${baseUrl}/signon-caaqil.php?t=${token}` };
}

/**
 * Internal endpoint consumed by the signon bridge: validates a single-use
 * token (constant-time hash compare, atomic claim) and returns the limited
 * MySQL credentials for the panel MySQL server.
 */
export async function exchangeToken(
  token: string,
  internalSecretValue: string,
): Promise<{ ok: true; user: string; password: string; host: string; port: number } | { ok: false; error: string }> {
  const stored = await getSetting("pma_internal_secret");
  if (!stored) return { ok: false, error: "internal secret missing" };
  if (!safeEqual(decryptSecret(stored), internalSecretValue)) {
    return { ok: false, error: "bad internal secret" };
  }

  const hash = tokenHash(token);
  const tokenRow = await one<{ user_id: string; expires_at: number }>(
    "SELECT user_id, expires_at FROM pma_tokens WHERE token_hash = ?",
    [hash],
  );
  if (!tokenRow) return { ok: false, error: "token not found" };
  if (Number(tokenRow.expires_at) <= Date.now()) return { ok: false, error: "token expired" };

  const claimed = await execute(
    "UPDATE pma_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?",
    [Date.now(), hash, Date.now()],
  );
  if (claimed.affectedRows !== 1) return { ok: false, error: "token already used" };

  const user = await one<{ role: string }>("SELECT role FROM users WHERE id = ?", [tokenRow.user_id]);
  if (!user) return { ok: false, error: "user gone" };

  const creds = await pmaCredentials();
  return { ok: true, ...creds, host: "mysql", port: 3306 };
}

/** Housekeeping: drop expired or used tokens. */
export async function prunePmaTokens(): Promise<void> {
  try {
    await execute("DELETE FROM pma_tokens WHERE expires_at < ? OR used_at IS NOT NULL", [
      Date.now() - PMA_TOKEN_TTL_MS * 10,
    ]);
  } catch {
    /* ignore */
  }
}

/** Clean a stale signon file if the panel was uninstalled out-of-band. */
export async function ensurePmaDir(): Promise<void> {
  await fs.mkdir(PMA_DIR, { recursive: true });
}
