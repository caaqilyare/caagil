import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import * as files from "@/lib/files";

export const dynamic = "force-dynamic";

function failure(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return NextResponse.json({ error: message }, { status: 400 });
}

export async function GET(req: Request) {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const app = url.searchParams.get("app") ?? "";
  const rel = url.searchParams.get("path") ?? "/";

  try {
    if (url.searchParams.get("download")) {
      const file = await files.download(app, rel);
      return new NextResponse(new Uint8Array(file.buffer), {
        headers: {
          "content-type": file.type,
          "content-disposition": `attachment; filename="${file.filename}"`,
          "cache-control": "no-store",
        },
      });
    }
    return NextResponse.json(await files.list(app, rel));
  } catch (err) {
    return failure(err);
  }
}

type Body = {
  app?: string;
  op?: string;
  path?: string;
  content?: string;
  name?: string;
  from?: string;
  to?: string;
  filename?: string;
  data?: string;
};

export async function POST(req: Request) {
  if (!(await currentUser())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const app = String(body.app ?? "");
  const target = String(body.path ?? "/");

  try {
    switch (body.op) {
      case "read":
        return NextResponse.json(await files.read(app, target));
      case "write":
        return NextResponse.json(await files.write(app, target, String(body.content ?? "")));
      case "mkdir":
        return NextResponse.json(await files.mkdir(app, target));
      case "remove":
        return NextResponse.json(await files.remove(app, target));
      case "rename":
        return NextResponse.json(await files.rename(app, target, String(body.to ?? "")));
      case "upload":
        return NextResponse.json(
          await files.upload(app, target, String(body.filename ?? ""), String(body.data ?? "")),
        );
      default:
        throw new Error("Unknown file operation.");
    }
  } catch (err) {
    return failure(err);
  }
}
