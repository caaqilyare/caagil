import test from "node:test";
import assert from "node:assert/strict";
import { formatBytes, imageUniqueBytes, isDanglingImage } from "../lib/storage";

test("formatBytes renders readable units", () => {
  assert.equal(formatBytes(0), "0 B");
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1024), "1 KB");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(1024 * 1024), "1 MB");
  assert.equal(formatBytes(1024 * 1024 * 1024), "1 GB");
  assert.equal(formatBytes(15 * 1024 * 1024 * 1024), "15 GB");
  assert.equal(formatBytes(-5), "0 B");
  assert.equal(formatBytes(Number.NaN), "0 B");
});

test("isDanglingImage only matches untagged images", () => {
  assert.equal(isDanglingImage({ RepoTags: null, Size: 10 }), true);
  assert.equal(isDanglingImage({ RepoTags: [], Size: 10 }), true);
  assert.equal(isDanglingImage({ RepoTags: ["<none>:<none>"], Size: 10 }), true);
  assert.equal(isDanglingImage({ RepoTags: ["<none>", "<none>:<none>"], Size: 10 }), true);
  // A tagged image — including the :previous rollback tag — is never dangling.
  assert.equal(isDanglingImage({ RepoTags: ["caaqil-panel:latest"], Size: 10 }), false);
  assert.equal(isDanglingImage({ RepoTags: ["caaqil-panel:previous"], Size: 10 }), false);
  assert.equal(
    isDanglingImage({ RepoTags: ["node:22-alpine", "caaqil-panel:latest"], Size: 10 }),
    false,
  );
});

test("imageUniqueBytes subtracts shared layers and never goes negative", () => {
  assert.equal(imageUniqueBytes({ Size: 1000, SharedSize: 400 }), 600);
  assert.equal(imageUniqueBytes({ Size: 1000 }), 1000);
  assert.equal(imageUniqueBytes({ Size: 100, SharedSize: 500 }), 0);
  assert.equal(imageUniqueBytes({ Size: Number.NaN, SharedSize: 10 }), 0);
});
