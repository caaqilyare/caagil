import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret, safeEqual } from "../lib/crypto";

test("encryptSecret/decryptSecret round-trips arbitrary strings", () => {
  const values = [
    "hunter2",
    "p@ssw0rd with spaces & symbols !@#$%^&*()",
    "áéíóú-ñ-ç-日本語-🔐",
    "a".repeat(500),
  ];
  for (const value of values) {
    const stored = encryptSecret(value);
    assert.ok(stored.startsWith("enc:v1:"), "ciphertext carries the version prefix");
    assert.notEqual(stored, value, "ciphertext differs from plaintext");
    assert.equal(decryptSecret(stored), value);
  }
});

test("encryptSecret produces a different ciphertext each time (random IV)", () => {
  const a = encryptSecret("same-secret");
  const b = encryptSecret("same-secret");
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a), decryptSecret(b));
});

test("decryptSecret passes through legacy plaintext rows", () => {
  assert.equal(decryptSecret("plain-old-password"), "plain-old-password");
  assert.equal(decryptSecret(""), "");
  assert.equal(decryptSecret(null), "");
  assert.equal(decryptSecret(undefined), "");
});

test("decryptSecret rejects tampered ciphertext without leaking", () => {
  const stored = encryptSecret("sensitive");
  // Flip a character in the payload segment.
  const parts = stored.split(":");
  const payload = parts[3];
  const flipped = payload.slice(0, 2) + (payload[2] === "A" ? "B" : "A") + payload.slice(3);
  const tampered = [parts[0], parts[1], parts[2], flipped].join(":");
  assert.equal(decryptSecret(tampered), "");
});

test("decryptSecret rejects malformed ciphertext", () => {
  assert.equal(decryptSecret("enc:v1:only-one-part"), "");
  assert.equal(decryptSecret("enc:v1:::"), "");
});

test("safeEqual compares safely", () => {
  assert.equal(safeEqual("abc", "abc"), true);
  assert.equal(safeEqual("abc", "abd"), false);
  assert.equal(safeEqual("abc", "abcd"), false);
  assert.equal(safeEqual("", ""), true);
});
