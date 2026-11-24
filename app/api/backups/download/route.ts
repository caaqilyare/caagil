import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { openBackupStream } from "@/lib/backup";

export const dynamic = "force-dynamic";

/** GET /api/backups/download?id=... — authenticated stream of a stored backup. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  try {
    const { stream, size, file } = await openBackupStream(id);
    // Convert the Node stream to a web ReadableStream for NextResponse.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        stream.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
      cancel() {
        stream.destroy();
      },
    });
    return new NextResponse(body, {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename="${file}"`,
        "content-length": String(size),
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
