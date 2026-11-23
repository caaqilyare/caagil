import fs from "node:fs/promises";
import path from "node:path";
import { getSetting } from "./db";

/**
 * Edge routing for the panel itself lives in a Traefik file-provider config so
 * the domain can be changed from the UI without editing docker-compose or
 * restarting Traefik.
 */
export const EDGE_DIR = process.env.EDGE_DIR || path.join(process.cwd(), "edge");
export const EDGE_FILE = path.join(EDGE_DIR, "panel.yml");

export type PanelEdge = {
  /** Hostname used for the HTTPS router. */
  domain: string | null;
  /** Public IP used for the optional plain-HTTP router. */
  ip: string | null;
  /** Serve the panel on http://<ip> when no certificate is possible. */
  allowIp: boolean;
};

const HOST_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function isIpAddress(value: string): boolean {
  if (!IPV4_RE.test(value)) return false;
  return value.split(".").every((part) => Number(part) >= 0 && Number(part) <= 255);
}

export function normalizeDomain(input: string): string {
  const clean = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  if (!clean) throw new Error("Panel domain cannot be empty.");
  if (isIpAddress(clean)) {
    throw new Error("That is an IP address. Use the IP access toggle instead of a domain.");
  }
  if (!HOST_RE.test(clean)) {
    throw new Error("Enter a hostname like panel.example.com — no scheme, path or port.");
  }
  return clean;
}

export function normalizeIp(input: string): string {
  const clean = input.trim();
  if (!isIpAddress(clean)) throw new Error("Enter a valid IPv4 address, e.g. 203.0.113.10.");
  return clean;
}

function q(value: string): string {
  return JSON.stringify(value);
}

export function renderPanelEdge(edge: PanelEdge): string {
  const lines: string[] = [
    "# Managed by Caaqil — edit this from Settings → Access, not by hand.",
    "# The owner of /edge must be writable by the panel container.",
    "http:",
  ];

  const routers: string[] = [];
  const middlewares: string[] = [];

  if (edge.domain) {
    routers.push(
      [
        "    caaqil-panel:",
        `      rule: ${q(`Host(\`${edge.domain}\`)`)}`,
        "      entryPoints: [websecure]",
        "      service: caaqil-panel",
        "      priority: 150",
        "      tls:",
        "        certResolver: le",
      ].join("\n"),
    );
    routers.push(
      [
        "    caaqil-panel-http:",
        `      rule: ${q(`Host(\`${edge.domain}\`)`)}`,
        "      entryPoints: [web]",
        "      service: caaqil-panel",
        "      middlewares: [caaqil-panel-https]",
        "      priority: 150",
      ].join("\n"),
    );
    middlewares.push(
      ["    caaqil-panel-https:", "      redirectScheme:", "        scheme: https", "        permanent: true"].join(
        "\n",
      ),
    );
  }

  if (edge.allowIp && edge.ip) {
    routers.push(
      [
        "    caaqil-panel-ip:",
        `      rule: ${q(`Host(\`${edge.ip}\`)`)}`,
        "      entryPoints: [web]",
        "      service: caaqil-panel",
        "      priority: 160",
      ].join("\n"),
    );
  }

  lines.push("  routers:", routers.length ? routers.join("\n") : "    {}");
  if (middlewares.length) lines.push("  middlewares:", middlewares.join("\n"));

  lines.push(
    "  services:",
    "    caaqil-panel:",
    "      loadBalancer:",
    "        servers:",
    '          - url: "http://panel:4000"',
    "",
  );

  return lines.join("\n");
}

/** Atomically write the panel edge config. Traefik's file watcher reloads it. */
export async function writePanelEdge(edge: PanelEdge): Promise<void> {
  const body = renderPanelEdge(edge);
  await fs.mkdir(EDGE_DIR, { recursive: true });
  const tmp = path.join(EDGE_DIR, ".panel.yml.tmp");
  await fs.writeFile(tmp, body, { mode: 0o644 });
  await fs.rename(tmp, EDGE_FILE);
}

/**
 * Rewrite the panel edge config unchanged (with a refresh marker) so the file
 * watcher reloads it and Traefik retries pending certificate requests.
 */
export async function refreshPanelEdge(): Promise<void> {
  const edge = await panelEdgeSettings();
  const body = `${renderPanelEdge(edge)}\n# refreshed ${Date.now()}\n`;
  await fs.mkdir(EDGE_DIR, { recursive: true });
  const tmp = path.join(EDGE_DIR, ".panel.yml.tmp");
  await fs.writeFile(tmp, body, { mode: 0o644 });
  await fs.rename(tmp, EDGE_FILE);
}

export async function panelEdgeSettings(): Promise<PanelEdge> {
  const [domain, ip, allowIp] = await Promise.all([
    getSetting("panel_domain"),
    getSetting("public_ip"),
    getSetting("allow_ip_access"),
  ]);
  // An empty string means "IP-only" — only fall back to the env default when
  // the setting has never been written.
  const resolvedDomain =
    domain === null
      ? process.env.PANEL_DOMAIN?.trim().toLowerCase() || null
      : domain.trim().toLowerCase() || null;
  return {
    domain: resolvedDomain,
    ip: ip?.trim() || null,
    allowIp: allowIp === "1",
  };
}

/** Best-effort public IP discovery used when IP access is enabled without an IP. */
export async function detectPublicIp(): Promise<string | null> {
  const endpoints = ["https://ifconfig.me/ip", "https://api.ipify.org"];
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;
      const text = (await res.text()).trim();
      if (isIpAddress(text)) return text;
    } catch {
      /* try the next endpoint */
    }
  }
  return null;
}
