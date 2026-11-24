import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { createLaunchToken } from "@/lib/pma";
import { logActivity } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * GET /api/pma/launch — signed-in panel user requests a one-time phpMyAdmin
 * session. Creates a 60s single-use token and redirects the browser to the
 * signon bridge inside the phpMyAdmin container. The token never appears in
 * panel logs and the MySQL credentials never appear in any URL.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  try {
    const { url } = await createLaunchToken(user.id);
    return NextResponse.redirect(url, { status: 302 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logActivity("pma.launch", `failed: ${message}`, user.email, false);
    return NextResponse.redirect(new URL(`/databases?pma_error=${encodeURIComponent(message)}`, req.url));
  }
}
