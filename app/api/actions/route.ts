import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { setSetting } from "@/lib/db";
import * as ops from "@/lib/ops";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { execute, one } from "@/lib/db";

export const dynamic = "force-dynamic";

type Body = { action: string; payload?: Record<string, unknown> };

export async function POST(req: Request) {
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
