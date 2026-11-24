import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlocked, MAX_FAILS_IP, MAX_FAILS_USER, WINDOW_MS } from "../lib/ratelimit";

const NOW = 1_000_000_000_000;

test("isBlocked allows normal traffic", () => {
  const fails = Array.from({ length: MAX_FAILS_USER - 1 }, (_, i) => NOW - i * 1000);
  const result = isBlocked(fails, NOW);
  assert.equal(result.blocked, false);
  assert.equal(result.retryAfterMs, 0);
});

test("isBlocked blocks after MAX_FAILS_USER failures inside the window", () => {
  const fails = Array.from({ length: MAX_FAILS_USER }, (_, i) => NOW - i * 1000);
  const result = isBlocked(fails, NOW);
  assert.equal(result.blocked, true);
  assert.ok(result.retryAfterMs > 0);
  assert.ok(result.retryAfterMs <= WINDOW_MS);
});

test("isBlocked ignores failures older than the window", () => {
  const stale = Array.from({ length: MAX_FAILS_USER + 3 }, (_, i) => NOW - WINDOW_MS - 1000 - i * 1000);
  const result = isBlocked(stale, NOW);
  assert.equal(result.blocked, false);
});

test("isBlocked unblocks once the window slides past the oldest failure", () => {
  // 8 failures, 1s apart, all inside the window at NOW (oldest has 8s left).
  const oldest = NOW - WINDOW_MS + 8_000;
  const fails = Array.from({ length: MAX_FAILS_USER }, (_, i) => oldest - i * 1000);
  assert.equal(isBlocked(fails, NOW).blocked, true);
  // 9 seconds later the first failure has left the window → 7 recent < 8.
  const later = NOW + 9_000;
  const result = isBlocked(fails, later);
  assert.equal(result.blocked, false);
});

test("isBlocked handles empty input", () => {
  assert.equal(isBlocked([], NOW).blocked, false);
});
