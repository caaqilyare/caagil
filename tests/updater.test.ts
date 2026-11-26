import assert from "node:assert/strict";
import { test } from "node:test";
import { isUpdateAvailable, sameCommit } from "../lib/update-version";

const A = "0d6c4a9f2b1c3d4e5f60718293a4b5c6d7e8f901";
const B = "0d6c4a9f2b1c3d4e5f60718293a4b5c6d7e8f901";

test("sameCommit matches identical full SHAs", () => {
  assert.equal(sameCommit(A, B), true);
});

test("sameCommit matches a short SHA in either direction", () => {
  assert.equal(sameCommit(A, A.slice(0, 7)), true);
  assert.equal(sameCommit(A.slice(0, 7), A), true);
});

test("sameCommit rejects different commits and unknown values", () => {
  assert.equal(sameCommit(A, A.replace(/^0d/, "ff")), false);
  assert.equal(sameCommit("unknown", A), false);
  assert.equal(sameCommit("", A), false);
});

test("isUpdateAvailable is false when origin/main is unknown", () => {
  assert.equal(isUpdateAvailable(A, null), false);
  assert.equal(isUpdateAvailable("unknown", null), false);
});

test("isUpdateAvailable compares known commits", () => {
  assert.equal(isUpdateAvailable(A, A), false);
  assert.equal(isUpdateAvailable(A, A.slice(0, 7)), false);
  assert.equal(isUpdateAvailable(A, A.replace(/^0d/, "ff")), true);
});

test("isUpdateAvailable offers the update when the build commit is unknown", () => {
  assert.equal(isUpdateAvailable("unknown", A), true);
  assert.equal(isUpdateAvailable("", A), true);
});
