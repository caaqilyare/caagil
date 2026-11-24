import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { setSetting } from "@/lib/db";
import * as ops from "@/lib/ops";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { execute, one, logActivity } from "@/lib/db";
import { originGuard } from "@/lib/httpsec";
import {
  mysqlInfo,
  managedDatabases,
  createManagedDatabase,
  dropManagedDatabase,
  databaseUsers,
  createDatabaseUser,
  setUserPassword,
  dropDatabaseUser,
  grantUserDatabase,
  revokeUserDatabase,
  exportDatabase,
  importDatabase,
} from "@/lib/mysqladmin";
import * as pma from "@/lib/pma";
import * as cronEngine from "@/lib/cron-engine";
import { describeCron } from "@/lib/cron";
import * as backups from "@/lib/backup";

export const dynamic = "force-dynamic";

type Body = { action: string; payload?: Record<string, unknown> };

export async function POST(req: Request) {
  const csrf = originGuard(req);
  if (csrf) return csrf;

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { action, payload = {} } = (await req.json().catch(() => ({}))) as Body;
  const actor = user.email;

  try {
    const result = await run(action, payload, actor, user.id);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

async function run(action: string, p: Record<string, unknown>, actor: string, userId: string) {
  const s = (k: string) => String(p[k] ?? "");
  const n = (k: string) => Number(p[k]);

  const wpOptions = (raw: unknown) => {
    if (!raw || typeof raw !== "object") return undefined;
    const w = raw as Record<string, unknown>;
    return {
      autoInstall: w.autoInstall !== false,
      title: w.title ? String(w.title) : undefined,
      adminUser: w.adminUser ? String(w.adminUser) : undefined,
      adminPassword: w.adminPassword ? String(w.adminPassword) : undefined,
      adminEmail: w.adminEmail ? String(w.adminEmail) : undefined,
    };
  };

  switch (action) {
    /* apps */
    case "app.create":
      return ops.startAppCreate(
        {
          name: s("name"),
          preset: s("preset") || "php84",
          image: p.image ? s("image") : undefined,
          port: p.port ? n("port") : undefined,
          command: p.command ? s("command") : undefined,
          gitUrl: p.gitUrl ? s("gitUrl") : undefined,
          branch: p.branch ? s("branch") : undefined,
          domain: p.domain ? s("domain") : undefined,
          pathPrefix: p.pathPrefix ? s("pathPrefix") : undefined,
          pathHost: p.pathHost ? s("pathHost") : undefined,
          stripPrefix: p.stripPrefix !== false,
          notes: p.notes ? s("notes") : undefined,
          env: (p.env as Record<string, string>) ?? {},
          wp: wpOptions(p.wp),
        },
        actor,
      );
    case "app.start":
    case "app.stop":
    case "app.restart":
    case "app.delete":
      return ops.appAction(s("name"), action.split(".")[1] as "start" | "stop" | "restart" | "delete", actor);
    case "app.redeploy":
      return ops.redeployApp(s("name"), actor);
    case "app.env":
      return ops.setAppEnv(s("name"), (p.env as Record<string, string>) ?? {}, actor);
    case "app.wpinstall":
      return ops.startWpInstall(
        s("name"),
        {
          title: p.title ? s("title") : undefined,
          adminUser: p.adminUser ? s("adminUser") : undefined,
          adminPassword: p.adminPassword ? s("adminPassword") : undefined,
          adminEmail: p.adminEmail ? s("adminEmail") : undefined,
        },
        actor,
      );
    case "ssl.status":
      return ops.sslStatus();
    case "ssl.add":
      return ops.startSslIssue(s("domain"), actor);
    case "app.route":
      return ops.setAppRoute(
        s("name"),
        {
          host: p.host ? s("host") : null,
          path: p.path ? s("path") : null,
          strip: p.strip !== false,
        },
        actor,
      );
    case "app.logs":
      return { logs: await ops.appLogs(s("name"), p.lines ? n("lines") : 300) };

    /* databases */
    case "db.create":
      return ops.createDatabase(
        {
          name: s("name"),
          engine: s("engine") || "mysql",
          version: p.version ? s("version") : undefined,
          remote: Boolean(p.remote),
          publicPort: p.publicPort ? n("publicPort") : undefined,
          username: p.username ? s("username") : undefined,
          password: p.password ? s("password") : undefined,
        },
        actor,
      );
    case "db.start":
    case "db.stop":
    case "db.restart":
    case "db.delete":
    case "db.expose":
    case "db.unexpose":
      return ops.databaseAction(
        s("name"),
        action.split(".")[1] as "start" | "stop" | "restart" | "delete" | "expose" | "unexpose",
        actor,
        p.publicPort ? n("publicPort") : undefined,
      );

    /* domains */
    case "domain.add":
      return ops.addDomain(s("host"), s("app"), actor);
    case "domain.remove":
      return ops.removeDomain(s("id"), actor);

    /* phpMyAdmin */
    case "pma.status":
      return pma.pmaStatus();
    case "pma.start":
      return pma.ensurePmaContainer(actor);
    case "pma.stop":
      return pma.stopPma(actor);
    case "pma.launch": {
      const launch = await pma.createLaunchToken(userId);
      await logActivity("pma.launch", "phpMyAdmin session opened", actor);
      return launch;
    }

    /* managed mysql admin */
    case "mysqldb.info":
      return mysqlInfo();
    case "mysqldb.list":
      return { databases: await managedDatabases() };
    case "mysqldb.create":
      return createManagedDatabase(s("name"), actor);
    case "mysqldb.drop":
      return dropManagedDatabase(s("name"), actor);
    case "mysqldb.export": {
      const dump = await exportDatabase(s("name"), actor);
      return {
        filename: dump.filename,
        sql: dump.buffer.toString("utf8"),
      };
    }
    case "mysqldb.import": {
      const sql = p.sql as string | undefined;
      if (!sql) throw new Error("No SQL content provided for import.");
      return importDatabase(s("name"), Buffer.from(sql, "utf8"), actor);
    }
    case "dbuser.list":
      return { users: await databaseUsers() };
    case "dbuser.create":
      return createDatabaseUser(
        s("name"),
        Array.isArray(p.databases) ? p.databases.map(String) : [],
        p.password ? s("password") : undefined,
        actor,
      );
    case "dbuser.password": {
      const res = await setUserPassword(s("name"), p.password ? s("password") : undefined, actor);
      return { password: res.password };
    }
    case "dbuser.drop":
      return dropDatabaseUser(s("name"), actor);
    case "dbuser.grant":
      return grantUserDatabase(s("name"), s("database"), actor);
    case "dbuser.revoke":
      return revokeUserDatabase(s("name"), s("database"), actor);

    /* cron */
    case "cron.list":
      return { jobs: await cronEngine.listCronJobs() };
    case "cron.create": {
      const job = await cronEngine.createCronJob(
        {
          name: s("name"),
          expression: s("expression"),
          targetKind: (s("targetKind") as "panel" | "app") || "panel",
          targetName: p.targetName ? s("targetName") : undefined,
          command: s("command"),
          timeoutSec: p.timeoutSec ? n("timeoutSec") : undefined,
        },
        actor,
      );
      return { job, description: describeCron(job.expression) };
    }
    case "cron.update":
      return cronEngine.updateCronJob(
        s("id"),
        {
          name: p.name !== undefined ? s("name") : undefined,
          expression: p.expression !== undefined ? s("expression") : undefined,
          command: p.command !== undefined ? s("command") : undefined,
          enabled: p.enabled !== undefined ? Boolean(p.enabled) : undefined,
          timeoutSec: p.timeoutSec ? n("timeoutSec") : undefined,
        },
        actor,
      );
    case "cron.delete":
      return cronEngine.deleteCronJob(s("id"), actor);
    case "cron.run":
      return cronEngine.runCronJobNow(s("id"), actor);
    case "cron.history":
      return { runs: await cronEngine.cronJobHistory(s("id"), p.limit ? n("limit") : 30) };
    case "cron.preview":
      return { next: cronEngine.previewNextRuns(s("expression"), 3) };

    /* backups */
    case "backup.list":
      return { backups: await backups.listBackups() };
    case "backup.create":
      return s("kind") === "db"
        ? backups.createDatabaseBackup(s("target"), actor, p.note ? s("note") : undefined)
        : backups.createFilesBackup(s("target"), actor, p.note ? s("note") : undefined);
    case "backup.restore":
      return s("kind") === "db" || (await backups.getBackup(s("id")))?.kind === "db"
        ? backups.restoreDatabaseBackup(s("id"), actor)
        : backups.restoreFilesBackup(s("id"), actor);
    case "backup.delete":
      return backups.deleteBackup(s("id"), actor);
    case "backup.verify":
      return backups.verifyBackup(s("id"), actor);
    case "backup.retention":
      return { removed: await backups.applyRetention(p.keep ? n("keep") : 10, actor) };

    /* external mysql */
    case "target.add":
      return ops.addTarget(
        {
          name: s("name"),
          host: s("host"),
          port: p.port ? n("port") : 3306,
          username: s("username"),
          password: p.password ? s("password") : undefined,
          ssl: Boolean(p.ssl),
        },
        actor,
      );
    case "target.remove":
      return ops.removeTarget(s("id"), actor);
    case "target.test":
      return ops.testTarget(s("id"));
    case "target.query":
      return ops.targetQuery(s("id"), s("sql"));

    /* settings */
    case "settings.profile": {
      const email = s("email").trim().toLowerCase();
      const currentPassword = s("currentPassword");
      if (!email || !email.includes("@")) throw new Error("A valid email address is required.");
      const row = await one<{ password: string }>("SELECT password FROM users WHERE id = ?", [userId]);
      if (!row || !verifyPassword(currentPassword, row.password)) {
        throw new Error("Current password is incorrect.");
      }
      const exists = await one<{ id: string }>("SELECT id FROM users WHERE email = ? AND id != ?", [email, userId]);
      if (exists) throw new Error("This email is already in use by another account.");
      await execute("UPDATE users SET email = ? WHERE id = ?", [email, userId]);
      await logActivity("user.profile_update", `Updated account email/username to ${email}`, actor);
      return { saved: true, email };
    }
    case "settings.password": {
      const current = s("current");
      const next = s("next");
      if (next.length < 10) throw new Error("New password must be at least 10 characters.");
      const row = await one<{ password: string }>("SELECT password FROM users WHERE id = ?", [userId]);
      if (!row || !verifyPassword(current, row.password)) throw new Error("Current password is wrong.");
      await execute("UPDATE users SET password = ? WHERE id = ?", [hashPassword(next), userId]);
      await execute("DELETE FROM sessions WHERE user_id = ?", [userId]);
      return { saved: true };
    }
    case "settings.factory_reset": {
      if (s("confirm").trim().toUpperCase() !== "RESET") {
        throw new Error("Please type RESET to confirm factory reset.");
      }
      // 1. Delete all deployed applications
      const apps = await ops.listApps();
      for (const a of apps) {
        await ops.appAction(a.name, "delete", actor).catch(() => {});
      }
      // 2. Drop user/app managed databases (except system caaqil DB)
      try {
        const dbs = await managedDatabases();
        for (const db of dbs) {
          if (!["caaqil", "information_schema", "performance_schema", "mysql", "sys"].includes(db.name)) {
            await dropManagedDatabase(db.name, actor).catch(() => {});
          }
        }
      } catch {}
      // 3. Clear domains
      await execute("DELETE FROM domains").catch(() => {});
      // 4. Clear cron jobs and cron history
      await execute("DELETE FROM cron_runs").catch(() => {});
      await execute("DELETE FROM cron_jobs").catch(() => {});
      // 5. Delete all backups from disk and DB
      try {
        const backupList = await backups.listBackups();
        for (const b of backupList) {
          await backups.deleteBackup(b.id, actor).catch(() => {});
        }
        await backups.sweepOrphanFiles().catch(() => {});
      } catch {}
      // 6. Clear metrics history and activity log
      await execute("DELETE FROM metrics").catch(() => {});
      await execute("DELETE FROM activity").catch(() => {});
      // 7. Clear external targets
      await execute("DELETE FROM targets").catch(() => {});
      // 8. Log the reset
      await logActivity("panel.factory_reset", "Panel reset to fresh factory state", actor);
      return { reset: true };
    }
    case "settings.save": {
      if (p.panelName !== undefined) await setSetting("panel_name", s("panelName"));
      let access: Awaited<ReturnType<typeof ops.savePanelAccess>> | undefined;
      if (p.panelDomain !== undefined || p.allowIpAccess !== undefined || p.publicIp !== undefined) {
        access = await ops.savePanelAccess(
          {
            domain: p.panelDomain !== undefined ? s("panelDomain") : undefined,
            allowIp: p.allowIpAccess !== undefined ? Boolean(p.allowIpAccess) : undefined,
            ip: p.publicIp !== undefined ? s("publicIp") : undefined,
          },
          actor,
        );
      }
      if (p.aiProvider !== undefined) await setSetting("ai_provider", s("aiProvider"));
      if (p.aiModel !== undefined) await setSetting("ai_model", s("aiModel"));
      const keys = (p.keys as Record<string, string>) ?? {};
      for (const [provider, value] of Object.entries(keys)) {
        await setSetting(`ai_${provider}_key`, value);
      }
      return { saved: true, access };
    }

    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
