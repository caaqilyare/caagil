import crypto from "node:crypto";

/** Public path prefix for every MongoDB studio. */
export const MONGO_STUDIO_BASE = "/mongo";

/**
 * Path used by Traefik's PathPrefix rule (no trailing slash so both
 * `/mongo/app` and `/mongo/app/` match).
 */
export function studioRoutePath(name: string): string {
  assertStudioName(name);
  return `${MONGO_STUDIO_BASE}/${name}`;
}

/**
 * Base URL handed to mongo-express as ME_CONFIG_SITE_BASEURL. The trailing
 * slash matters: its static assets and redirects are generated relative to it.
 */
export function studioBasePath(name: string): string {
  return `${studioRoutePath(name)}/`;
}

/** Only slug-safe database names may appear in a public path. */
export function assertStudioName(name: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) {
    throw new Error("MongoDB studio is only available for panel-created database names.");
  }
}

/**
 * htpasswd entry for Traefik's basicauth middleware. `{SHA}` is
 * base64(SHA-1(password)) — supported by Traefik without extra tooling.
 */
export function htpasswdEntry(user: string, password: string): string {
  const hash = crypto.createHash("sha1").update(password, "utf8").digest("base64");
  return `${user}:{SHA}${hash}`;
}

/** MongoDB connection string for the panel-managed instance (root auth). */
export function mongoConnectionUrl(
  user: string,
  password: string,
  host: string,
  port = 27017,
  authSource = "admin",
): string {
  return `mongodb://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/?authSource=${encodeURIComponent(authSource)}`;
}
