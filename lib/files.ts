import fs from "node:fs/promises";
import path from "node:path";
import { one } from "./db";
import { SITES_DIR } from "./docker";

/**
 * File manager for app sources. Every path is resolved inside
 * data/sites/<app> and symlinks that escape that folder are rejected.
 */

export type FileEntry = {
  name: string;
  dir: boolean;
  size: number;
  mtime: number;
  symlink: boolean;
};

const MAX_EDIT = 2 * 1024 * 1024;
const MAX_UPLOAD = 8 * 1024 * 1024;
const MAX_DOWNLOAD = 25 * 1024 * 1024;

export function normalizeRel(input: string): string {
  const parts = String(input ?? "/")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== ".");
  if (parts.some((part) => part === "..")) throw new Error("Path traversal is not allowed.");
  return "/" + parts.join("/");
}

function inside(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root + path.sep);
}

async function appRoot(name: string): Promise<string> {
  const app = await one<{ name: string }>("SELECT name FROM apps WHERE name = ?", [name]);
  if (!app) throw new Error("App not found.");
  const dir = path.join(SITES_DIR, app.name);
  await fs.mkdir(dir, { recursive: true });
  return fs.realpath(dir);
}

async function resolve(name: string, input: string) {
  const root = await appRoot(name);
  const rel = normalizeRel(input);
  const abs = path.resolve(root, "." + rel);
  if (!inside(root, abs)) throw new Error("Path escapes the app folder.");

  const exists = await fs.realpath(abs).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (exists) {
    if (!inside(root, exists)) throw new Error("Path escapes the app folder.");
  } else {
    const parent = await fs.realpath(path.dirname(abs));
    if (!inside(root, parent)) throw new Error("Path escapes the app folder.");
  }

  return { root, rel, abs };
}

export async function list(name: string, input: string) {
  const { rel, abs } = await resolve(name, input);
  const stat = await fs.stat(abs);
  if (!stat.isDirectory()) throw new Error("Not a folder.");

  const dirents = await fs.readdir(abs, { withFileTypes: true });
  const entries: FileEntry[] = [];
  for (const dirent of dirents) {
    const info = await fs.lstat(path.join(abs, dirent.name)).catch(() => null);
    entries.push({
      name: dirent.name,
      dir: dirent.isDirectory(),
      size: info?.size ?? 0,
      mtime: info?.mtimeMs ?? 0,
      symlink: dirent.isSymbolicLink(),
    });
  }
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));

  return {
    path: rel,
    entries,
    editable: true,
    maxEdit: MAX_EDIT,
    maxUpload: MAX_UPLOAD,
  };
}

export async function read(name: string, input: string) {
  const { rel, abs } = await resolve(name, input);
  const stat = await fs.stat(abs);
  if (!stat.isFile()) throw new Error("Not a file.");
  if (stat.size > MAX_EDIT) throw new Error("File is too large to edit (limit 2 MB). Download it instead.");
  const buf = await fs.readFile(abs);
  if (buf.includes(0)) throw new Error("This looks like a binary file. Download it instead.");
  return { path: rel, size: stat.size, content: buf.toString("utf8") };
}

export async function write(name: string, input: string, content: string) {
  const { rel, abs } = await resolve(name, input);
  if (Buffer.byteLength(content, "utf8") > MAX_EDIT) throw new Error("Content is too large (limit 2 MB).");
  await fs.writeFile(abs, content, "utf8");
  return { path: rel, saved: true };
}

export async function mkdir(name: string, input: string) {
  const { rel, abs } = await resolve(name, input);
  await fs.mkdir(abs);
  return { path: rel, created: true };
}

export async function remove(name: string, input: string) {
  const { root, rel, abs } = await resolve(name, input);
  if (abs === root) throw new Error("Cannot delete the app root.");
  await fs.rm(abs, { recursive: true });
  return { path: rel, deleted: true };
}

export async function rename(name: string, from: string, to: string) {
  const source = await resolve(name, from);
  const target = await resolve(name, to);
  if (source.abs === source.root) throw new Error("Cannot move the app root.");
  await fs.rename(source.abs, target.abs);
  return { from: source.rel, to: target.rel, moved: true };
}

export async function upload(name: string, input: string, filename: string, base64: string) {
  const safe = path.basename(filename).replace(/[^A-Za-z0-9._-]/g, "_");
  if (!safe || safe === "." || safe === "..") throw new Error("Invalid file name.");
  const dir = normalizeRel(input);
  const target = dir === "/" ? `/${safe}` : `${dir}/${safe}`;
  const { rel, abs } = await resolve(name, target);

  const buf = Buffer.from(base64, "base64");
  if (buf.length === 0) throw new Error("Empty upload.");
  if (buf.length > MAX_UPLOAD) throw new Error("File is too large (limit 8 MB).");
  await fs.writeFile(abs, buf);
  return { path: rel, size: buf.length, uploaded: true };
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".php": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
};

export async function download(name: string, input: string) {
  const { rel, abs } = await resolve(name, input);
  const stat = await fs.stat(abs);
  if (!stat.isFile()) throw new Error("Not a file.");
  if (stat.size > MAX_DOWNLOAD) throw new Error("File is too large to download (limit 25 MB).");
  const buffer = await fs.readFile(abs);
  const filename = path.basename(rel).replace(/["\\\r\n]/g, "_") || "download";
  return {
    buffer,
    filename,
    type: TYPES[path.extname(rel).toLowerCase()] ?? "application/octet-stream",
  };
}
