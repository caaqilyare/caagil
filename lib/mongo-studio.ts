/**
 * MongoDB Studio — a managed mongo-express container per panel database.
 *
 * Why one container per database instead of one shared admin:
 *  - each instance only ever sees its own root credentials;
 *  - Traefik routes it under /mongo/<name> with its own basic-auth user;
 *  - stopping the database's studio does not affect the database itself.
 *
 * Security: mongo-express runs behind Traefik basic auth (random password,
 * generated once and stored encrypted in `settings`). No credential is ever
 * placed in a URL. The studio is only reachable while its container runs.
 */
import { getSetting, setSetting, logActivity } from "./db";
import { randomToken, encryptSecret, decryptSecret } from "./crypto";
import { docker, pullIfMissing, removeContainerSafe, runContainer, traefikLabels } from "./docker";
import { panelEdgeSettings } from "./edge";
import { getDatabase, type DatabaseRow } from "./ops";
import {
  assertStudioName,
  htpasswdEntry,
  mongoConnectionUrl,
  studioBasePath,
  studioRoutePath,
} from "./mongo-studio-util";

export const MONGO_STUDIO_IMAGE = "mongo-express:1.0.2-20";
export const MONGO_STUDIO_PORT = 8081;
export const MONGO_STUDIO_USER = "caaqil";

const CONTAINER_PREFIX = "mongo-studio-";

export type MongoStudioStatus = {
  database: string;
  installed: boolean;
  running: boolean;
  url: string | null;
  username: string | null;
  password: string | null;
  error?: string;
};

function specName(name: string): string {
  return `${CONTAINER_PREFIX}${name}`;
}

function credentialKey(name: string): string {
  return `mongo_studio_cred_${name}`;
}

async function panelOrigin(): Promise<{ origin: string; host: string } | null> {
  const edge = await panelEdgeSettings();
  if (edge.domain) return { origin: `https://${edge.domain}`, host: edge.domain };
  if (edge.allowIp && edge.ip) return { origin: `http://${edge.ip}`, host: edge.ip };
  return null;
}

async function requireMongoDb(name: string): Promise<DatabaseRow> {
  assertStudioName(name);
  const db = await getDatabase(name);
  if (!db) throw new Error("Database not found.");
  if (db.engine !== "mongo") throw new Error("MongoDB Studio is only available for MongoDB databases.");
  return db;
}

/** Read the generated basic-auth credentials, without creating them. */
async function readCredentials(name: string): Promise<{ username: string; password: string } | null> {
  const stored = await getSetting(credentialKey(name));
  if (!stored) return null;
  try {
    const parsed = JSON.parse(decryptSecret(stored)) as { username?: string; password?: string };
    if (!parsed.username || !parsed.password) return null;
    return { username: parsed.username, password: parsed.password };
  } catch {
    return null;
  }
}

async function ensureCredentials(name: string): Promise<{ username: string; password: string }> {
  const existing = await readCredentials(name);
  if (existing) return existing;
  const fresh = { username: MONGO_STUDIO_USER, password: randomToken(18) };
  await setSetting(credentialKey(name), encryptSecret(JSON.stringify(fresh)));
  return fresh;
}

export async function mongoStudioStatus(name: string): Promise<MongoStudioStatus> {
  const db = await requireMongoDb(name);
  const edge = await panelOrigin();
  const url = edge ? `${edge.origin}${studioBasePath(db.name)}` : null;
  const creds = await readCredentials(db.name);

  let installed = false;
  let running = false;
  let error: string | undefined;

  try {
    const info = await docker.getContainer(`caaqil-${specName(db.name)}`).inspect();
    installed = true;
    running = info.State?.Running === true;
    if (!running && info.State?.Status === "exited") {
      error = `MongoDB Studio stopped (exit ${info.State?.ExitCode ?? 0}).`;
    }
  } catch {
    installed = false;
  }

  return {
    database: db.name,
    installed,
    running,
    url,
    username: creds?.username ?? null,
    password: creds?.password ?? null,
    ...(error ? { error } : {}),
  };
}

/** Create (or recreate) the studio for one MongoDB database. */
export async function ensureMongoStudio(name: string, actor = "system"): Promise<MongoStudioStatus> {
  const db = await requireMongoDb(name);
  const edge = await panelOrigin();
  if (!edge) {
    throw new Error("MongoDB Studio needs a panel domain or IP access before it can start.");
  }

  const creds = await ensureCredentials(db.name);
  const routePath = studioRoutePath(db.name);
  const basePath = studioBasePath(db.name);
  const service = `caaqil-mongo-${db.name}`;

  await removeContainerSafe(null, specName(db.name));
  await pullIfMissing(MONGO_STUDIO_IMAGE);

  const labels = traefikLabels(
    `mongo-${db.name}`,
    [{ host: edge.host, path: routePath }],
    MONGO_STUDIO_PORT,
  );
  // Traefik basic auth guards the studio; credentials are shown only in the panel.
  labels[`traefik.http.middlewares.${service}-auth.basicauth.users`] = htpasswdEntry(
    creds.username,
    creds.password,
  );
  labels[`traefik.http.routers.${service}-0.middlewares`] = `${service}-auth`;
  labels["caaqil.kind"] = "mongo-studio";
  labels["caaqil.mongo"] = db.name;

  await runContainer({
    name: specName(db.name),
    image: MONGO_STUDIO_IMAGE,
    port: MONGO_STUDIO_PORT,
    env: {
      ME_CONFIG_MONGODB_URL: mongoConnectionUrl(
        db.username || MONGO_STUDIO_USER,
        db.password || "",
        `db-${db.name}`,
        Number(db.port) || 27017,
      ),
      ME_CONFIG_MONGODB_ENABLE_ADMIN: "true",
      ME_CONFIG_BASICAUTH: "true",
      ME_CONFIG_BASICAUTH_USERNAME: creds.username,
      ME_CONFIG_BASICAUTH_PASSWORD: creds.password,
      ME_CONFIG_SITE_BASEURL: basePath,
      ME_CONFIG_SITE_COOKIESECRET: randomToken(16),
      ME_CONFIG_SITE_SESSIONSECRET: randomToken(16),
    },
    labels,
  });

  await logActivity("mongo.studio.start", `${db.name} at ${routePath}`, actor);
  return mongoStudioStatus(db.name);
}

export async function stopMongoStudio(name: string, actor = "system"): Promise<MongoStudioStatus> {
  const db = await requireMongoDb(name);
  await removeContainerSafe(null, specName(db.name));
  await logActivity("mongo.studio.stop", db.name, actor);
  return mongoStudioStatus(db.name);
}

/** Drop the studio container and its stored basic-auth credentials. */
export async function removeMongoStudio(name: string): Promise<void> {
  await removeContainerSafe(null, specName(name)).catch(() => {});
  await setSetting(credentialKey(name), null).catch(() => {});
}

/** Recreate running studios after the panel hostname/IP changes (labels embed it). */
export async function refreshMongoStudiosIfRunning(): Promise<void> {
  let list: { Names: string[] }[] = [];
  try {
    list = await docker.listContainers({ all: true, filters: { label: ["caaqil.kind=mongo-studio"] } });
  } catch {
    return;
  }
  for (const container of list) {
    const label = container.Names[0] ?? "";
    const base = label.split("/").pop() ?? "";
    const name = base.replace(/^caaqil-mongo-studio-/, "");
    if (!name) continue;
    await ensureMongoStudio(name, "system").catch(() => {});
  }
}
