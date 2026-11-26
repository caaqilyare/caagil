import assert from "node:assert/strict";
import { test } from "node:test";
import { CAAQIL_VERSION, nextVersion } from "../lib/version";
import { changelogBullets, parseLatestSection } from "../lib/changelog";

test("release rule increments the last segment by one", () => {
  assert.equal(nextVersion("1.6.0.1"), "1.6.0.2");
  assert.equal(nextVersion("1.6.0.9"), "1.6.0.10");
  assert.equal(nextVersion("2.10.3.99"), "2.10.3.100");
});

test("a three-segment version gets .1 on the next release", () => {
  assert.equal(nextVersion("1.6.0"), "1.6.0.1");
});

test("nextVersion rejects versions that do not follow the rule", () => {
  assert.throws(() => nextVersion("1.6"), /Invalid version/);
  assert.throws(() => nextVersion("v1.6.0"), /Invalid version/);
  assert.throws(() => nextVersion("abc"), /Invalid version/);
});

test("CAAQIL_VERSION is a four-segment release version", () => {
  assert.match(CAAQIL_VERSION, /^\d+\.\d+\.\d+\.\d+$/);
  assert.notEqual(nextVersion(CAAQIL_VERSION), CAAQIL_VERSION);
});

const CHANGELOG = `# Changelog

## 1.6.0.1 — Newest

- **First** change with \`code\`.
- Second change
  continued here.

## 1.6.0 — Older

- Old change.
`;

test("parseLatestSection returns the newest section only", () => {
  const section = parseLatestSection(CHANGELOG);
  assert.ok(section);
  assert.equal(section.version, "1.6.0.1");
  assert.equal(section.title, "Newest");
  assert.ok(section.body.includes("First"));
  assert.ok(!section.body.includes("Old change"));
});

test("parseLatestSection handles hyphen headings and missing changelogs", () => {
  const section = parseLatestSection("## 1.2.3.4 - Hyphen title\n\n- done\n");
  assert.ok(section);
  assert.equal(section.version, "1.2.3.4");
  assert.equal(section.title, "Hyphen title");
  assert.equal(parseLatestSection("no headings here"), null);
  assert.equal(parseLatestSection(""), null);
});

test("changelogBullets strips markdown and folds wrapped lines", () => {
  const section = parseLatestSection(CHANGELOG);
  assert.ok(section);
  const bullets = changelogBullets(section.body);
  assert.equal(bullets[0], "First change with code.");
  assert.equal(bullets[1], "Second change continued here.");
  assert.equal(changelogBullets(section.body, 1).length, 1);
});
