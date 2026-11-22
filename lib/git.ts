import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { SITES_DIR } from "./docker";

const run = promisify(execFile);

export async function cloneOrPull(
  url: string,
  branch: string | null,
  name: string,
): Promise<{ dir: string; cloned: boolean }> {
  const dir = path.join(SITES_DIR, name);
  await fs.mkdir(SITES_DIR, { recursive: true });

  const exists = await fs
    .stat(path.join(dir, ".git"))
    .then(() => true)
    .catch(() => false);

  if (!exists) {
    await run("git", ["clone", "--depth", "1", ...(branch ? ["--branch", branch] : []), url, dir], {
      timeout: 120_000,
    });
    return { dir, cloned: true };
  }

  await run("git", ["-C", dir, "fetch", "--depth", "1", "origin", ...(branch ? [branch] : [])], {
    timeout: 120_000,
  });
  await run("git", ["-C", dir, "reset", "--hard", "origin/" + (branch || "HEAD")], {
    timeout: 60_000,
  }).catch(() => {});
  return { dir, cloned: false };
}

export async function gitInfo(name: string): Promise<{ commit: string; branch: string } | null> {
  const dir = path.join(SITES_DIR, name);
  try {
    const { stdout: commit } = await run("git", ["-C", dir, "rev-parse", "--short", "HEAD"]);
    const { stdout: branch } = await run("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"]);
    return { commit: commit.trim(), branch: branch.trim() };
  } catch {
    return null;
  }
}
