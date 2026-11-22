import Docker from "dockerode";
import path from "node:path";

const socketPath = process.env.DOCKER_SOCKET || "/var/run/docker.sock";

export const docker = new Docker({ socketPath });
export const NETWORK = process.env.PANEL_NETWORK || "caagil";
export const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
/** Host path that maps to DATA_DIR, used for bind mounts into child containers. */
export const HOST_DATA_DIR = process.env.HOST_DATA_DIR || DATA_DIR;
export const SITES_DIR = path.join(DATA_DIR, "sites");
export const HOST_SITES_DIR = path.join(HOST_DATA_DIR, "sites");

export async function ensureNetwork(): Promise<void> {
  try {
    await docker.getNetwork(NETWORK).inspect();
  } catch {
    await docker.createNetwork({
      Name: NETWORK,
      Driver: "bridge",
      Labels: { "caagil.managed": "true" },
    });
  }
}

export async function dockerHealthy(): Promise<{ ok: boolean; error?: string }> {
  try {
    await docker.ping();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function containerName(name: string): string {
  return `caagil-${name}`;
}

export type TraefikRoute = {
  /** Hostname the route answers on. Empty means any host (avoid). */
  host?: string | null;
  /** Optional path prefix such as /blog. */
  path?: string | null;
  /** Strip the prefix before proxying (useful for apps mounted under a subpath). */
  strip?: boolean;
};

export function traefikLabels(
  id: string,
  routes: TraefikRoute[],
  port: number,
): Record<string, string> {
  const clean = routes
    .map((r) => ({
      host: (r.host ?? "").trim().toLowerCase() || null,
      path: (r.path ?? "").trim() || null,
      strip: Boolean(r.strip),
    }))
    .filter((r) => r.host || r.path);

  if (clean.length === 0) return {};

  const service = `caagil-${id}`;
  const labels: Record<string, string> = {
    "traefik.enable": "true",
    "traefik.docker.network": NETWORK,
    [`traefik.http.services.${service}.loadbalancer.server.port`]: String(port),
  };

  let stripPath: string | null = null;

  clean.forEach((route, index) => {
    const router = `${service}-${index}`;
    const rule = [
      route.host ? `Host(\`${route.host}\`)` : null,
      route.path ? `PathPrefix(\`${route.path}\`)` : null,
    ]
      .filter(Boolean)
      .join(" && ");

    labels[`traefik.http.routers.${router}.rule`] = rule;
    labels[`traefik.http.routers.${router}.entrypoints`] = "websecure";
    labels[`traefik.http.routers.${router}.tls.certresolver`] = "le";
    labels[`traefik.http.routers.${router}.service`] = service;
    // Path routes must win over the panel's own Host-only router.
    labels[`traefik.http.routers.${router}.priority`] = route.path ? "200" : "100";

    // Per-router HTTP→HTTPS redirect (the entrypoint has no global redirect,
    // so plain-HTTP IP access to the panel can work when enabled).
    labels[`traefik.http.routers.${router}-http.rule`] = rule;
    labels[`traefik.http.routers.${router}-http.entrypoints`] = "web";
    labels[`traefik.http.routers.${router}-http.service`] = service;
    labels[`traefik.http.routers.${router}-http.middlewares`] = `${service}-https`;
    labels[`traefik.http.routers.${router}-http.priority`] = route.path ? "200" : "100";

    if (route.path && route.strip) {
      stripPath = route.path;
      labels[`traefik.http.routers.${router}.middlewares`] = `${service}-strip,${service}-fwd`;
    }
  });

  if (stripPath) {
    labels[`traefik.http.middlewares.${service}-strip.stripprefix.prefixes`] = stripPath;
    // Tell the app where the public URL lives so frameworks that rebuild
    // redirects from the request path (WordPress auth, …) keep the prefix.
    labels[
      `traefik.http.middlewares.${service}-fwd.headers.customRequestHeaders.X-Forwarded-Prefix`
    ] = stripPath;
  }

  labels[`traefik.http.middlewares.${service}-https.redirectscheme.scheme`] = "https";
  labels[`traefik.http.middlewares.${service}-https.redirectscheme.permanent`] = "true";

  return labels;
}

/**
 * Remove a managed container by id and/or name. Never throws for a container
 * that is already gone; retries once for containers stuck in removal.
 */
export async function removeContainerSafe(
  containerId: string | null | undefined,
  name?: string,
): Promise<void> {
  const candidates = new Set<string>();
  if (containerId) candidates.add(containerId);
  if (name) candidates.add(containerName(name));

  for (const id of candidates) {
    const container = docker.getContainer(id);
    try {
      const info = await container.inspect();
      if (info.State?.Running) await container.kill().catch(() => {});
    } catch {
      continue; // already gone
    }
    try {
      await container.remove({ force: true, v: true });
    } catch {
      // Docker can report "removal in progress" — give it a moment and retry.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await container.remove({ force: true, v: true });
    }
  }
}

export async function containerLogs(containerId: string, tail = 300): Promise<string> {
  const c = docker.getContainer(containerId);
  const buf = (await c.logs({ stdout: true, stderr: true, tail, follow: false })) as Buffer;
  return buf
    .toString("utf8")
    .replace(
      // docker multiplexed stream: 8-byte header per frame
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,
      "",
    );
}

export type AppContainerSpec = {
  name: string;
  image: string;
  port: number;
  command?: string | null;
  env?: Record<string, string>;
  labels?: Record<string, string>;
  binds?: string[];
};

export async function runContainer(spec: AppContainerSpec) {
  await ensureNetwork();
  await pullIfMissing(spec.image);
  const name = containerName(spec.name);

  const existing = docker.getContainer(name);
  try {
    const info = await existing.inspect();
    if (info.State?.Running) await existing.stop({ t: 5 }).catch(() => {});
    await existing.remove({ force: true });
  } catch {
    /* not present */
  }

  const container = await docker.createContainer({
    name,
    Image: spec.image,
    Cmd: spec.command ? ["sh", "-lc", spec.command] : undefined,
    Env: Object.entries(spec.env ?? {}).map(([k, v]) => `${k}=${v}`),
    ExposedPorts: { [`${spec.port}/tcp`]: {} },
    Labels: { "caagil.managed": "true", ...(spec.labels ?? {}) },
    HostConfig: {
      RestartPolicy: { Name: "unless-stopped" },
      Binds: spec.binds ?? [],
      NetworkMode: NETWORK,
    },
    NetworkingConfig: { EndpointsConfig: { [NETWORK]: { Aliases: [spec.name] } } },
  });

  await container.start();
  return container;
}

export async function pullIfMissing(image: string) {
  try {
    await docker.getImage(image).inspect();
    return;
  } catch {
    /* needs pull */
  }
  await new Promise<void>((resolve, reject) => {
    docker.pull(image, (err: Error | null, stream: NodeJS.ReadableStream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (e: Error | null) => (e ? reject(e) : resolve()));
    });
  });
}

export async function containerIp(containerId: string): Promise<string | null> {
  const info = await docker.getContainer(containerId).inspect();
  const net = info.NetworkSettings?.Networks?.[NETWORK];
  return net?.IPAddress || null;
}
