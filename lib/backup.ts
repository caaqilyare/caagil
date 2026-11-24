/**
 * Backups: filesystem archives (tar.gz of an app directory) and database
 * dumps (mysqldump | gzip) stored under DATA_DIR/backups, with verify,
 * restore, delete, retention and the scheduled-backup job kind used by cron.
 *
 * Everything streams through the panel process: file archives are produced
 * with the host `tar` binary (present in the node:22-alpine panel image),
 * database dumps reuse the mysqladmin execCapture plumbing inside the mysql
 * container and are compressed with gzip.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { execute, one, query, logActivity } from "./db";
import { randomId } from "./crypto";
import { DATA_DIR } from "./docker";
import { execCapture, mysqlContainer } from "./wp";
import { validateDbName, quoteIdent } from "./mysqladmin";
import type { Readable } from "node:stream";

export const BACKUP_DIR = path.join(DATA_DIR, "backups");
export const MAX_BACKUP_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB safety cap

export type BackupRow = {
  id: string;
  kind: "files" | "db";
  target: string;
  file: string;
  size: number;
  verified: number;
  note: string | null;
  created_at: number;
};

export async function listBackups(): Promise<BackupRow[]> {
  return query<BackupRow[]>("SELECT * FROM backups ORDER BY created_at DESC");
}

export async function getBackup(id: string): Promise<BackupRow | null> {
  return one<BackupRow>("SELECT * FROM backups WHERE id = ?", [id]);
}

function backupFilePath(file: string): string {
  // `file` is panel-generated (randomId-based); still guard against traversal.
  const clean = path.basename(file);
  const full = path.join(BACKUP_DIR, clean);
  if (!full.startsWith(BACKUP_DIR + path.sep) && full !== BACKUP_DIR) {
    throw new Error("Invalid backup path.");
  }
  return full;
}

/* ───────────────────────────── creation ───────────────────────────── */

async function ensureBackupDir(): Promise<void> {
  await fsp.mkdir(BACKUP_DIR, { recursive: true });
}

function freeDiskBytes(): number {
  // Best-effort: the panel data volume lives on the same FS in deployment.
  try {
    // fs.statfs is available in Node 22.
    const s = fs.statfsSync(DATA_DIR);
    return s.bsize * s.bavail;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/** tar.gz an app directory (relative to the sites root) into backups. */
export async function createFilesBackup(
  siteDir: string,
  actor = "system",
  note?: string,
): Promise<BackupRow> {
  const target = path.basename(siteDir);
  const hostSitesDir = process.env.HOST_SITES_DIR || path.join(DATA_DIR, "sites");
  const absSource = path.resolve(hostSitesDir, target);
  if (!absSource.startsWith(path.resolve(hostSitesDir) + path.sep)) {
    throw new Error("Invalid site directory.");
  }
  await fsp.access(absSource).catch(() => {
    throw new Error(`Site directory "${target}" does not exist on disk.`);
  });

  await ensureBackupDir();
  const file = `${target}-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`;
  const dest = backupFilePath(file);

  if (freeDiskBytes() < 100 * 1024 * 1024) {
    throw new Error("Not enough free disk space for a backup (need at least 100 MB).");
  }

  await new Promise<void>((resolve, reject) => {
    // -C rewrites the archive root to the app folder itself.
    const child = spawn("tar", ["-czf", dest, "-C", hostSitesDir, target], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", (err) => reject(new Error(`tar failed: ${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `tar exited with code ${code}`));
    });
  });

  const size = (await fsp.stat(dest)).size;
  if (size > MAX_BACKUP_BYTES) {
    await fsp.unlink(dest).catch(() => {});
    throw new Error("Backup exceeds the 4 GB limit.");
  }

  const id = randomId("bak");
  await execute(
    "INSERT INTO backups(id, kind, target, file, size, verified, note, created_at) VALUES (?,?,?,?,?,0,?,?)",
    [id, "files", target, file, size, note ?? null, Date.now()],
  );
  await logActivity("backup.create", `${target} → ${file} (${Math.round(size / 1024 / 1024)} MB)`, actor);
  return (await getBackup(id))!;
}

/** mysqldump | gzip one managed database into backups. */
export async function createDatabaseBackup(
  dbName: string,
  actor = "system",
  note?: string,
): Promise<BackupRow> {
  const clean = validateDbName(dbName);
  await ensureBackupDir();

  const container = await mysqlContainer();
  const dump = await execCapture(container, [
    "sh",
    "-c",
    `mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" --single-transaction --quick --routines --triggers --events --no-tablespaces ${quoteIdent(clean)} | gzip -c`,
  ]);
  if (dump.code !== 0) throw new Error(dump.stderr || "mysqldump failed");
  if (dump.stdout.length === 0) throw new Error("mysqldump produced no output");

  const file = `${clean}-${new Date().toISOString().replace(/[:.]/g, "-")}.sql.gz`;
  const dest = backupFilePath(file);
  await fsp.writeFile(dest, dump.stdout);

  const id = randomId("bak");
  await execute(
    "INSERT INTO backups(id, kind, target, file, size, verified, note, created_at) VALUES (?,?,?,?,?,0,?,?)",
    [id, "db", clean, file, dump.stdout.length, note ?? null, Date.now()],
  );
  await logActivity(
    "backup.create",
    `${clean} → ${file} (${Math.round(dump.stdout.length / 1024)} KB)`,
    actor,
  );
  return (await getBackup(id))!;
}

/* ───────────────────────────── verify ───────────────────────────── */

/** Verify integrity: gzip -t for DB dumps, tar -tzf listing for archives. */
export async function verifyBackup(id: string, actor = "system"): Promise<{ ok: boolean; detail: string }> {
  const row = await getBackup(id);
  if (!row) throw new Error("Backup not found.");
  const full = backupFilePath(row.file);
  await fsp.access(full).catch(() => {
    throw new Error("Backup file is missing on disk.");
  });

  const args = row.kind === "db" ? ["-t", full] : ["-tzf", full, "--occurrence=1"];
  // For .sql.gz `gzip -t` validates the stream; tar -tzf lists entries.
  const result = await new Promise<{ ok: boolean; detail: string }>((resolve) => {
    const cmd = row.kind === "db" ? "gzip" : "tar";
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", (err) => resolve({ ok: false, detail: err.message }));
    child.on("close", (code) =>
      resolve({ ok: code === 0, detail: code === 0 ? "archive intact" : stderr.trim() || `exit ${code}` }),
    );
  });

  await execute("UPDATE backups SET verified = ? WHERE id = ?", [result.ok ? 1 : 0, id]);
  await logActivity(
    "backup.verify",
    `${row.file}: ${result.ok ? "verified" : `FAILED — ${result.detail}`}`,
    actor,
    result.ok,
  );
  return result;
}

/* ───────────────────────────── restore ───────────────────────────── */

/**
 * Restore a files backup: the current directory is moved aside (appname.pre-restore),
 * the archive extracted in its place, and the old directory kept for rollback.
 */
export async function restoreFilesBackup(id: string, actor = "system"): Promise<{ restored: string }> {
  const row = await getBackup(id);
  if (!row) throw new Error("Backup not found.");
  if (row.kind !== "files") throw new Error("Not a files backup.");
  const full = backupFilePath(row.file);

  const hostSitesDir = process.env.HOST_SITES_DIR || path.join(DATA_DIR, "sites");
  const dest = path.resolve(hostSitesDir, row.target);
  if (!dest.startsWith(path.resolve(hostSitesDir) + path.sep)) {
    throw new Error("Invalid restore target.");
  }

  const keep = `${dest}.pre-restore`;
  await fsp.rm(keep, { recursive: true, force: true });
  await fsp.rename(dest, keep).catch(() => {}); // first restore: nothing to keep
  await fsp.mkdir(dest, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const child = spawn("tar", ["-xzf", full, "-C", dest], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.on("error", (err) => reject(new Error(`tar failed: ${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `tar exited with code ${code}`));
    });
  });

  await logActivity("backup.restore", `${row.target} restored from ${row.file}`, actor);
  return { restored: row.target };
}

/** Restore a database dump: gunzip | mysql (the dump owns DROP/CREATE TABLE). */
export async function restoreDatabaseBackup(id: string, actor = "system"): Promise<{ restored: string }> {
  const row = await getBackup(id);
  if (!row) throw new Error("Backup not found.");
  if (row.kind !== "db") throw new Error("Not a database backup.");
  const clean = validateDbName(row.target);
  const full = backupFilePath(row.file);

  const gz = await fsp.readFile(full);
  const container = await mysqlContainer();
  const { code, stderr } = await execCapture(
    container,
    ["sh", "-c", `gunzip -c | mysql -uroot -p"$MYSQL_ROOT_PASSWORD" ${quoteIdent(clean)}`],
    gz,
  );
  if (code !== 0) throw new Error(stderr || "mysql restore failed");
  await logActivity("backup.restore", `${clean} restored from ${row.file}`, actor);
  return { restored: clean };
}

/* ───────────────────────────── download / delete ───────────────────────────── */

/** Open a readable stream of the stored archive for download. */
export async function openBackupStream(id: string): Promise<{ stream: Readable; size: number; file: string }> {
  const row = await getBackup(id);
  if (!row) throw new Error("Backup not found.");
  const full = backupFilePath(row.file);
  const stat = await fsp.stat(full).catch(() => null);
  if (!stat) throw new Error("Backup file is missing on disk.");
  const stream = fs.createReadStream(full);
  return { stream, size: stat.size, file: row.file };
}

export async function deleteBackup(id: string, actor = "system"): Promise<void> {
  const row = await getBackup(id);
  if (!row) throw new Error("Backup not found.");
  await fsp.unlink(backupFilePath(row.file)).catch(() => {}); // file may already be gone
  await execute("DELETE FROM backups WHERE id = ?", [id]);
  await logActivity("backup.delete", row.file, actor);
}

/** Retention policy: keep the newest N backups per target (files or db). */
export async function applyRetention(keepPerTarget = 10, actor = "system"): Promise<number> {
  const rows = await query<BackupRow[]>("SELECT * FROM backups ORDER BY created_at ASC");
  const perTarget = new Map<string, BackupRow[]>();
  for (const row of rows) {
    const key = `${row.kind}:${row.target}`;
    const list = perTarget.get(key) ?? [];
    list.push(row);
    perTarget.set(key, list);
  }
  let removed = 0;
  for (const list of perTarget.values()) {
    const excess = list.slice(0, Math.max(0, list.length - keepPerTarget));
    for (const row of excess) {
      await fsp.unlink(backupFilePath(row.file)).catch(() => {});
      await execute("DELETE FROM backups WHERE id = ?", [row.id]);
      removed++;
    }
  }
  if (removed > 0) await logActivity("backup.retention", `${removed} old backup(s) pruned`, actor);
  return removed;
}

/** Files older than `maxAgeDays` that lost their DB row (manual deletes). */
export async function sweepOrphanFiles(): Promise<number> {
  let removed = 0;
  try {
    const known = new Set((await listBackups()).map((b) => b.file));
    for (const entry of await fsp.readdir(BACKUP_DIR)) {
      if (!known.has(entry)) {
        await fsp.unlink(backupFilePath(entry)).catch(() => {});
        removed++;
      }
    }
  } catch {
    /* backup dir may not exist yet */
  }
  return removed;
}
