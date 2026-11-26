import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertStudioName,
  htpasswdEntry,
  mongoConnectionUrl,
  studioBasePath,
  studioRoutePath,
} from "../lib/mongo-studio-util";

test("studio paths keep the panel-safe slug and a trailing slash for baseUrl", () => {
  assert.equal(studioRoutePath("blog"), "/mongo/blog");
  assert.equal(studioBasePath("blog"), "/mongo/blog/");
  assert.equal(studioRoutePath("my-app-2"), "/mongo/my-app-2");
});

test("studio names reject path separators and unsafe input", () => {
  for (const bad of ["../etc", "Blog", "a b", "a/b", "", "-lead"]) {
    assert.throws(() => assertStudioName(bad), /only available|unsafe/i);
  }
  assert.doesNotThrow(() => assertStudioName("ok-name-1"));
});

test("htpasswdEntry produces a Traefik-compatible SHA entry", () => {
  const entry = htpasswdEntry("caaqil", "secret");
  assert.match(entry, /^caaqil:\{SHA\}[A-Za-z0-9+/]+=*$/);
  // base64(sha1("secret")) is deterministic.
  assert.equal(entry, "caaqil:{SHA}5en6G6MezRroT3XKqkdPOmY/BfQ=");
});

test("mongoConnectionUrl encodes credentials and sets authSource", () => {
  const url = mongoConnectionUrl("caaqil", "p@ss:word", "db-blog", 27017);
  assert.equal(
    url,
    "mongodb://caaqil:p%40ss%3Aword@db-blog:27017/?authSource=admin",
  );
});
