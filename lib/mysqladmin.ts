/**
 * Managed MySQL administration on the panel's own MySQL server: managed
 * database listing with sizes, database users, privileges, and SQL
 * import/export. Root credentials stay inside the mysql container — every
 * statement runs through `docker exec` with the root password env, and the
 * signon user for phpMyAdmin never receives global privileges.
 */
import { execute, one, query, getSetting, setSetting, logActivity } from "./db";
import { randomId, shortPassword, encryptSecret, decryptSecret } from "./crypto";
import { mysqlContainer, execCapture, execOutput } from "./wp";

/** Strict identifier rules — every name that reaches a SQL string literal. */
export const DB_NAME_RE = /^[a-z][a-z0-9_]{0,62}$/;
export const DB_USER_RE = /^[a-z][a-z0-9_]{0,30}$/;

export function validateDbName(name: string): string {
  const clean = name.trim().toLowerCase();
  if (!DB_NAME_RE.test(clean)) {
    throw new Error(
      "Database names are 1-63 chars: lowercase letters, numbers, underscore, starting with a letter.",
    );
  }
  return clean;
}

export function validateDbUser(name: string): string {
  const clean = name.trim().toLowerCase();
  if (!DB_USER_RE.test(clean)) {
    throw new Error(
      "User names are 1-31 chars: lowercase letters, numbers, underscore, starting with a letter.",
    );
  }
  return clean;
}

/** Quote a validated identifier for SQL; rejects anything outside [a-z0-9_]. */
export function quoteIdent(name: string): string {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `\`${name}\``;
}

/** Quote a value for a SQL string literal (passwords contain anything). */
function quoteValue(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

/* ───────────────────────────── raw SQL ───────────────────────────── */

async function runMysqlText(sql: string): Promise<string> {
  const container = await mysqlContainer();
  const b64 = Buffer.from(sql, "utf8").toString("base64");
  const { code, output } = await execOutput(container, [
    "sh",
    "-c",
    `printf %s ${b64} | base64 -d | mysql -uroot -p"$MYSQL_ROOT_PASSWORD" -N -B`,
  ]);
  if (code !== 0) throw new Error(output || `MySQL command failed (exit ${code})`);
  return output;
}

async function runRootSql(sql: string): Promise<void> {
  const container = await mysqlContainer();
  const b64 = Buffer.from(sql, "utf8").toString("base64");
  const { code, output } = await execOutput(container, [
    "sh",
    "-c",
    `printf %s ${b64} | base64 -d | mysql -uroot -p"$MYSQL_ROOT_PASSWORD"`,
  ]);
  if (code !== 0) throw new Error(output || `MySQL command failed (exit ${code})`);
}

/** Parse `mysql -N -B` (tab-separated, one row per line) into column arrays. */
export function parseMysqlRows(text: string): string[][] {
  return text
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.length > 0)
    .map((line) => line.split("\t"));
}

/* ───────────────────────── server information ───────────────────────── */

export type MysqlInfo = {
  version: string | null;
  uptimeSeconds: number | null;
  threadsConnected: number | null;
  maxConnections: number | null;
  sizeMb: number;
  databases: number;
  reachable: boolean;
  error?: string;
};

export async function mysqlInfo(): Promise<MysqlInfo> {
  try {
    const versionRows = parseMysqlRows(await runMysqlText("SELECT VERSION();"));
    const status = parseMysqlRows(await runMysqlText("SHOW GLOBAL STATUS LIKE 'Uptime';"));
    const threads = parseMysqlRows(
      await runMysqlText("SHOW GLOBAL STATUS LIKE 'Threads_connected';"),
    );
    const maxConn = parseMysqlRows(await runMysqlText("SHOW VARIABLES LIKE 'max_connections';"));
    const sizes = parseMysqlRows(
      await runMysqlText(
        `SELECT COALESCE(SUM(data_length + index_length), 0), COUNT(DISTINCT table_schema)
           FROM information_schema.TABLES
          WHERE table_schema NOT IN ('mysql','information_schema','performance_schema','sys');`,
      ),
    );
    return {
      version: versionRows[0]?.[0] ?? null,
      uptimeSeconds: Number(status[0]?.[1] ?? 0) || null,
      threadsConnected: Number(threads[0]?.[1] ?? 0) || null,
      maxConnections: Number(maxConn[0]?.[1] ?? 0) || null,
      sizeMb: Math.round((Number(sizes[0]?.[0] ?? 0) / 1024 / 1024) * 10) / 10,
      databases: Number(sizes[0]?.[1] ?? 0),
      reachable: true,
    };
  } catch (err) {
    return {
      version: null,
      uptimeSeconds: null,
      threadsConnected: null,
      maxConnections: null,
      sizeMb: 0,
      databases: 0,
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ─────────────────────── managed databases ─────────────────────── */

export type ManagedDatabase = {
  name: string;
  sizeMb: number;
  tables: number;
  app: string | null;
  createdAt: number | null;
};

/** Managed databases = schemas created by the panel (wp_* pattern / app_databases). */
export async function managedDatabases(): Promise<ManagedDatabase[]> {
  const rows = parseMysqlRows(
    await runMysqlText(
      `SELECT table_schema, ROUND(SUM(data_length + index_length)/1024/1024, 1), COUNT(*)
         FROM information_schema.TABLES
        WHERE table_schema NOT IN ('mysql','information_schema','performance_schema','sys','caaqil')
        GROUP BY table_schema ORDER BY table_schema;`,
    ),
  );
  const apps = await query<{ name: string; app_id: string }[]>(
    "SELECT name, app_id FROM app_databases",
  );
  const appRows = apps.length
    ? await query<{ id: string; name: string }[]>("SELECT id, name FROM apps")
    : [];
  const appName = new Map(appRows.map((a) => [a.id, a.name]));
  const appMap = new Map(apps.map((a) => [a.name, a.app_id]));

  return rows
    .filter((cols) => DB_NAME_RE.test(cols[0]))
    .map((cols) => {
      const appId = appMap.get(cols[0]);
      return {
        name: cols[0],
        sizeMb: Number(cols[1] ?? 0) || 0,
        tables: Number(cols[2] ?? 0) || 0,
        app: appId ? appName.get(appId) ?? null : null,
        createdAt: null,
      };
    });
}

export async function createManagedDatabase(
  name: string,
  actor = "system",
): Promise<ManagedDatabase> {
  const clean = validateDbName(name);
  await runRootSql(
    `CREATE DATABASE IF NOT EXISTS ${quoteIdent(clean)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
  );
  await logActivity("mysqldb.create", clean, actor);
  return { name: clean, sizeMb: 0, tables: 0, app: null, createdAt: Date.now() };
}

export async function dropManagedDatabase(name: string, actor = "system"): Promise<void> {
  const clean = validateDbName(name);
  const registered = await one("SELECT id FROM app_databases WHERE name = ?", [clean]);
  if (registered) {
    throw new Error("This database belongs to an app — delete it from the app card instead.");
  }
  await runRootSql(`DROP DATABASE IF EXISTS ${quoteIdent(clean)};`);
  const users = await databaseUsers();
  for (const user of users) {
    if (!user.databases.includes(clean)) continue;
    const remaining = user.databases.filter((d) => d !== clean);
    if (remaining.length === 0 && user.name !== PMA_USER) {
      await runRootSql(`DROP USER IF EXISTS ${quoteValue(user.name)}@${quoteValue(user.host)};`);
    } else {
      await runRootSql(
        `REVOKE ALL PRIVILEGES ON ${quoteIdent(clean)}.* FROM ${quoteValue(user.name)}@${quoteValue(user.host)};`,
      );
    }
  }
  await logActivity("mysqldb.drop", clean, actor);
}

/* ─────────────────────── database users ─────────────────────── */

export type DbUser = {
  name: string;
  host: string;
  databases: string[];
};

const SYSTEM_USERS = new Set([
  "root",
  "mysql.infoschema",
  "mysql.session",
  "mysql.sys",
  "mysql",
  "healthchecker",
  "",
]);

/** Users with at least one grant on a managed database (root never listed). */
export async function databaseUsers(): Promise<DbUser[]> {
  const userRows = parseMysqlRows(
    await runMysqlText("SELECT DISTINCT user, host FROM mysql.user ORDER BY user, host;"),
  );
  const users: DbUser[] = [];
  for (const [name, host] of userRows) {
    if (!name || SYSTEM_USERS.has(name) || !DB_USER_RE.test(name)) continue;
    users.push({ name, host: host ?? "%", databases: [] });
  }
  const grants = parseMysqlRows(
    await runMysqlText(
      `SELECT user, host, table_schema FROM information_schema.SCHEMA_PRIVILEGES
        WHERE table_schema NOT IN ('information_schema','performance_schema');`,
    ),
  );
  for (const [name, host, schema] of grants) {
    if (!schema || !DB_NAME_RE.test(schema)) continue;
    const user = users.find((u) => u.name === name && u.host === host);
    if (user && !user.databases.includes(schema)) user.databases.push(schema);
  }
  return users;
}

export async function createDatabaseUser(
  name: string,
  databases: string[],
  password?: string,
  actor = "system",
): Promise<{ name: string; password: string }> {
  const clean = validateDbUser(name);
  const pass = password || shortPassword(24);
  if (pass.length < 12) throw new Error("Use a password of at least 12 characters.");
  const dbs = databases.map(validateDbName);

  let sql = `CREATE USER IF NOT EXISTS ${quoteValue(clean)}@'%' IDENTIFIED BY ${quoteValue(pass)};`;
  sql += `ALTER USER ${quoteValue(clean)}@'%' IDENTIFIED BY ${quoteValue(pass)};`;
  for (const db of dbs) {
    sql += `GRANT ALL PRIVILEGES ON ${quoteIdent(db)}.* TO ${quoteValue(clean)}@'%';`;
  }
  sql += "FLUSH PRIVILEGES;";
  await runRootSql(sql);
  await logActivity("dbuser.create", `${clean} → ${dbs.join(", ") || "(no grants)"}`, actor);
  return { name: clean, password: pass };
}

export async function setUserPassword(
  name: string,
  password?: string,
  actor = "system",
): Promise<{ password: string }> {
  const clean = validateDbUser(name);
  const pass = password || shortPassword(24);
  if (pass.length < 12) throw new Error("Use a password of at least 12 characters.");
  await runRootSql(
    `ALTER USER ${quoteValue(clean)}@'%' IDENTIFIED BY ${quoteValue(pass)}; FLUSH PRIVILEGES;`,
  );
  await logActivity("dbuser.password", clean, actor);
  return { password: pass };
}

export async function dropDatabaseUser(name: string, actor = "system"): Promise<void> {
  const clean = validateDbUser(name);
  if (clean === PMA_USER) throw new Error("The phpMyAdmin user is managed by the panel.");
  await runRootSql(`DROP USER IF EXISTS ${quoteValue(clean)}@'%'; FLUSH PRIVILEGES;`);
  await logActivity("dbuser.drop", clean, actor);
}

export async function grantUserDatabase(name: string, db: string, actor = "system"): Promise<void> {
  const clean = validateDbUser(name);
  const cleanDb = validateDbName(db);
  await runRootSql(
    `GRANT ALL PRIVILEGES ON ${quoteIdent(cleanDb)}.* TO ${quoteValue(clean)}@'%'; FLUSH PRIVILEGES;`,
  );
  await logActivity("dbuser.grant", `${clean} → ${cleanDb}`, actor);
}

export async function revokeUserDatabase(
  name: string,
  db: string,
  actor = "system",
): Promise<void> {
  const clean = validateDbUser(name);
  const cleanDb = validateDbName(db);
  await runRootSql(
    `REVOKE ALL PRIVILEGES ON ${quoteIdent(cleanDb)}.* FROM ${quoteValue(clean)}@'%'; FLUSH PRIVILEGES;`,
  );
  await logActivity("dbuser.revoke", `${clean} ← ${cleanDb}`, actor);
}

/* ─────────────────── phpMyAdmin signon user (limited) ─────────────────── */

export const PMA_USER = "caaqil_pma";

/**
 * Ensure the dedicated phpMyAdmin user exists. It only receives privileges on
 * managed app databases (wp_% pattern) — never global rights, never the mysql
 * schema, never the panel database, never root. The password is stored
 * encrypted in settings and only travels server-to-server during signon.
 */
export async function ensurePmaUser(): Promise<void> {
  const stored = await getSetting("pma_user_password");
  const existing = parseMysqlRows(
    await runMysqlText(`SELECT user FROM mysql.user WHERE user = ${quoteValue(PMA_USER)};`),
  );
  if (existing.length > 0 && stored) return; // already provisioned

  const pass = stored ? decryptSecret(stored) : shortPassword(28);
  if (!pass) {
    await rotatePmaUserPassword();
    return;
  }
  await runRootSql(
    `CREATE USER IF NOT EXISTS ${quoteValue(PMA_USER)}@'%' IDENTIFIED BY ${quoteValue(pass)};
     ALTER USER ${quoteValue(PMA_USER)}@'%' IDENTIFIED BY ${quoteValue(pass)};
     GRANT ALL PRIVILEGES ON \`wp_%\`.* TO ${quoteValue(PMA_USER)}@'%';
     FLUSH PRIVILEGES;`,
  );
  if (!stored) await setSetting("pma_user_password", encryptSecret(pass));
}

/** Rotate the phpMyAdmin user password (also refreshes the panel-side copy). */
export async function rotatePmaUserPassword(): Promise<void> {
  const pass = shortPassword(28);
  await runRootSql(
    `ALTER USER ${quoteValue(PMA_USER)}@'%' IDENTIFIED BY ${quoteValue(pass)}; FLUSH PRIVILEGES;`,
  );
  await setSetting("pma_user_password", encryptSecret(pass));
}

export async function pmaCredentials(): Promise<{ user: string; password: string }> {
  await ensurePmaUser();
  const stored = await getSetting("pma_user_password");
  const password = decryptSecret(stored);
  if (!password) throw new Error("phpMyAdmin credentials are unavailable. Re-provision phpMyAdmin.");
  return { user: PMA_USER, password };
}

/* ─────────────────────── export / import ─────────────────────── */

/** Dump one managed database; returns the SQL dump as a Buffer. */
export async function exportDatabase(
  name: string,
  actor = "system",
): Promise<{ filename: string; buffer: Buffer }> {
  const clean = validateDbName(name);
  const container = await mysqlContainer();
  const flags =
    "--single-transaction --quick --routines --triggers --events --add-drop-table --no-tablespaces";
  const { code, stdout, stderr } = await execCapture(container, [
    "sh",
    "-c",
    `mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" ${flags} ${quoteIdent(clean)}`,
  ]);
  if (code !== 0) throw new Error(stderr || "mysqldump failed");
  if (stdout.length === 0) throw new Error("mysqldump produced no output");
  await logActivity(
    "mysqldb.export",
    `${clean} (${Math.round(stdout.length / 1024)} KB)`,
    actor,
  );
  return { filename: `${clean}-${new Date().toISOString().slice(0, 10)}.sql`, buffer: stdout };
}

/** Import a .sql dump into a managed database (the dump owns DROP/CREATE). */
export async function importDatabase(
  name: string,
  sql: Buffer,
  actor = "system",
): Promise<{ ok: true }> {
  const clean = validateDbName(name);
  if (sql.length === 0) throw new Error("The uploaded file is empty.");
  if (sql.length > 64 * 1024 * 1024) throw new Error("Import files are limited to 64 MB.");
  if (sql.includes(0)) throw new Error("This looks like a binary file, not a SQL dump.");
  const container = await mysqlContainer();
  const { code, stderr } = await execCapture(
    container,
    ["sh", "-c", `mysql -uroot -p"$MYSQL_ROOT_PASSWORD" ${quoteIdent(clean)}`],
    sql,
  );
  if (code !== 0) throw new Error(stderr || "mysql import failed");
  await logActivity("mysqldb.import", `${clean} (${Math.round(sql.length / 1024)} KB)`, actor);
  return { ok: true };
}

export async function managedDatabaseNames(): Promise<string[]> {
  return (await managedDatabases()).map((d) => d.name);
}

export function newOperationId(): string {
  return randomId("sqlop");
}
