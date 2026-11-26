#!/usr/bin/env node
/**
 * Release version helper. The project rule: every release increments the last
 * segment by exactly one (1.6.0.1 -> 1.6.0.2 -> 1.6.0.3) and never skips.
 *
 *   node scripts/next-version.mjs           print the next version
 *   node scripts/next-version.mjs --write   update version.ts, package.json,
 *                                           package-lock.json (root only)
 *
 * Keeping this in one script is what makes the rule enforceable instead of
 * relying on memory.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const versionFile = path.join(root, "lib", "version.ts");
const pkgFile = path.join(root, "package.json");
const lockFile = path.join(root, "package-lock.json");

function fail(message) {
  console.error(`next-version: ${message}`);
  process.exit(1);
}

function bump(current) {
  const match = current.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!match) fail(`invalid version "${current}" — expected 1.2.3 or 1.2.3.4`);
  const build = match[4] ? Number(match[4]) + 1 : 1;
  return `${match[1]}.${match[2]}.${match[3]}.${build}`;
}

function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const source = fs.readFileSync(versionFile, "utf8");
const found = source.match(/CAAQIL_VERSION\s*=\s*"([^"]+)"/);
if (!found) fail("CAAQIL_VERSION not found in lib/version.ts");

const current = found[1];
const next = bump(current);

if (!process.argv.includes("--write")) {
  console.log(next);
  process.exit(0);
}

// lib/version.ts
fs.writeFileSync(versionFile, source.replace(`"${current}"`, `"${next}"`), "utf8");

// package.json — only the top-level version (the first match).
const pkg = fs.readFileSync(pkgFile, "utf8");
const pkgVersion = new RegExp(`("version":\\s*)"${escapeRe(current)}"`);
if (!pkgVersion.test(pkg)) fail(`package.json does not contain version ${current}`);
fs.writeFileSync(pkgFile, pkg.replace(pkgVersion, `$1"${next}"`), "utf8");

// package-lock.json — the first two occurrences are the root version and
// packages[""].version; dependency versions must not be touched.
let lock = fs.readFileSync(lockFile, "utf8");
let seen = 0;
const lockVersion = new RegExp(`("version":\\s*)"${escapeRe(current)}"`, "g");
lock = lock.replace(lockVersion, (whole, prefix) => {
  seen += 1;
  return seen <= 2 ? `${prefix}"${next}"` : whole;
});
if (seen < 2) fail(`package-lock.json has fewer than two root version fields for ${current}`);
fs.writeFileSync(lockFile, lock, "utf8");

console.log(next);
