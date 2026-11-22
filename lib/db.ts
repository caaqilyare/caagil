import mysql from "mysql2/promise";
import type { Pool, RowDataPacket, ResultSetHeader } from "mysql2/promise";

const DB_NAME = process.env.PANEL_DB_NAME || "caagil";

const base = {
  host: process.env.PANEL_DB_HOST || "127.0.0.1",
  port: Number(process.env.PANEL_DB_PORT || 3306),
  user: process.env.PANEL_DB_USER || "root",
  password: process.env.PANEL_DB_PASSWORD || "",
  charset: "utf8mb4",
};

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(40) PRIMARY KEY,
  email VARCHAR(190) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'owner',
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  id VARCHAR(64) PRIMARY KEY,
  user_id VARCHAR(40) NOT NULL,
  expires_at BIGINT NOT NULL,
  INDEX(user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS apps (
  id VARCHAR(40) PRIMARY KEY,
  name VARCHAR(120) UNIQUE NOT NULL,
  runtime VARCHAR(20) NOT NULL DEFAULT 'php',
  image VARCHAR(255) NOT NULL,
  command TEXT NULL,
  port INT NOT NULL DEFAULT 80,
  env JSON NULL,
  domain VARCHAR(190) NULL,
  git_url TEXT NULL,
  branch VARCHAR(80) NULL,
  doc_root VARCHAR(255) NULL,
  mount_path VARCHAR(255) NULL,
  path_prefix VARCHAR(120) NULL,
  path_host VARCHAR(190) NULL,
  strip_prefix TINYINT NOT NULL DEFAULT 1,
  php_version VARCHAR(10) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'created',
  container_id VARCHAR(80) NULL,
  notes TEXT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS db_services (
  id VARCHAR(40) PRIMARY KEY,
  name VARCHAR(120) UNIQUE NOT NULL,
  engine VARCHAR(20) NOT NULL,
  version VARCHAR(20) NULL,
  port INT NOT NULL,
  public_port INT NULL,
  username VARCHAR(120) NULL,
  password VARCHAR(190) NULL,
  dbname VARCHAR(120) NULL,
  container_id VARCHAR(80) NULL,
  volume VARCHAR(190) NULL,
  remote TINYINT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'created',
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS targets (
  id VARCHAR(40) PRIMARY KEY,
  name VARCHAR(120) UNIQUE NOT NULL,
  host VARCHAR(190) NOT NULL,
  port INT NOT NULL DEFAULT 3306,
  username VARCHAR(120) NOT NULL,
  password VARCHAR(190) NULL,
  use_tls TINYINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS domains (
  id VARCHAR(40) PRIMARY KEY,
  host VARCHAR(190) UNIQUE NOT NULL,
  app_id VARCHAR(40) NULL,
  cert VARCHAR(30) NOT NULL DEFAULT 'letsencrypt',
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS settings (
  k VARCHAR(191) PRIMARY KEY,
  v TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS app_databases (
  id VARCHAR(40) PRIMARY KEY,
  app_id VARCHAR(40) NOT NULL,
  name VARCHAR(64) NOT NULL,
  username VARCHAR(64) NOT NULL,
  password VARCHAR(190) NOT NULL,
  host VARCHAR(120) NOT NULL DEFAULT 'mysql',
  created_at BIGINT NOT NULL,
  INDEX(app_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS activity (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  ts BIGINT NOT NULL,
  actor VARCHAR(120) NULL,
  action VARCHAR(80) NOT NULL,
  detail TEXT NULL,
  ok TINYINT NOT NULL DEFAULT 1,
  INDEX(ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ai_messages (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  thread VARCHAR(64) NOT NULL,
  role VARCHAR(20) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  ts BIGINT NOT NULL,
  INDEX(thread)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
`;

async function bootstrap(): Promise<Pool> {
  const root = await mysql.createConnection(base);
  await root.query(
    `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await root.end();

  const pool = mysql.createPool({
    ...base,
    database: DB_NAME,
    waitForConnections: true,
    connectionLimit: 8,
    timezone: "Z",
    dateStrings: true,
  });

  for (const statement of schema.split(";").map((s) => s.trim()).filter(Boolean)) {
    await pool.query(statement);
  }

  await migrate(pool);
  await seed(pool);
  return pool;
}

/** Adds columns introduced after the first release without dropping data. */
async function migrate(pool: Pool) {
  const columns: [table: string, column: string, ddl: string][] = [
    ["apps", "path_prefix", "path_prefix VARCHAR(120) NULL"],
    ["apps", "path_host", "path_host VARCHAR(190) NULL"],
    ["apps", "strip_prefix", "strip_prefix TINYINT NOT NULL DEFAULT 1"],
    ["apps", "mount_path", "mount_path VARCHAR(255) NULL"],
  ];

  for (const [table, column, ddl] of columns) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [DB_NAME, table, column],
    );
    if (Number(rows[0]?.c ?? 0) === 0) {
      await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`);
    }
  }
}

async function seed(pool: Pool) {
  const [rows] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS c FROM users");
  if (Number(rows[0]?.c ?? 0) > 0) return;

  // Default: the first visitor creates the owner account at /setup.
  // Set CAAGIL_AUTO_ADMIN=true for unattended provisioning.
  if (process.env.CAAGIL_AUTO_ADMIN !== "true") {
    console.log("[caagil] no users yet: first visit will open the setup wizard");
    return;
  }

  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn("[caagil] CAAGIL_AUTO_ADMIN=true but ADMIN_EMAIL/ADMIN_PASSWORD are missing");
    return;
  }
  const { hashPassword, randomId } = await import("./crypto");
  await pool.query("INSERT INTO users(id, email, password, role, created_at) VALUES(?,?,?,?,?)", [
    randomId("usr"),
    email.toLowerCase(),
    hashPassword(password),
    "owner",
    Date.now(),
  ]);
  console.log(`[caagil] created owner account ${email}`);
}

const g = globalThis as unknown as { __caagilPool?: Promise<Pool> };

export function pool(): Promise<Pool> {
  if (!g.__caagilPool) {
    g.__caagilPool = bootstrap().catch((err) => {
      g.__caagilPool = undefined;
      throw err;
    });
  }
  return g.__caagilPool;
}

export async function query<T = RowDataPacket[]>(
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const p = await pool();
  const [rows] = await p.query(sql, params);
  return rows as T;
}

export async function one<T = RowDataPacket>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T[]>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const p = await pool();
  const [res] = await p.query(sql, params);
  return res as ResultSetHeader;
}

export async function getSetting(key: string): Promise<string | null> {
  const row = await one<RowDataPacket>("SELECT v FROM settings WHERE k = ?", [key]);
  return (row?.v as string) ?? null;
}

export async function setSetting(key: string, value: string | null) {
  if (value === null || value === "") {
    await execute("DELETE FROM settings WHERE k = ?", [key]);
    return;
  }
  await execute(
    "INSERT INTO settings(k, v) VALUES(?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)",
    [key, value],
  );
}

export async function logActivity(
  action: string,
  detail: string,
  actor = "system",
  ok = true,
) {
  try {
    await execute("INSERT INTO activity(ts, actor, action, detail, ok) VALUES(?,?,?,?,?)", [
      Date.now(),
      actor,
      action,
      detail,
      ok ? 1 : 0,
    ]);
  } catch {
    /* logging must never break a request */
  }
}
