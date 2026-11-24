import { test } from "node:test";
import assert from "node:assert/strict";
import { sameOrigin } from "../lib/httpsec";

function req(headers: Record<string, string>): Request {
  return new Request("https://panel.example.com/api/actions", { method: "POST", headers });
}

test("sameOrigin accepts a matching Origin", () => {
  assert.equal(
    sameOrigin(req({ host: "panel.example.com", origin: "https://panel.example.com" })),
    true,
  );
});

test("sameOrigin accepts a matching Referer when Origin is absent", () => {
  assert.equal(
    sameOrigin(req({ host: "panel.example.com", referer: "https://panel.example.com/apps" })),
    true,
  );
});

test("sameOrigin rejects a foreign Origin", () => {
  assert.equal(
    sameOrigin(req({ host: "panel.example.com", origin: "https://evil.example.org" })),
    false,
  );
});

test("sameOrigin rejects a mismatched port", () => {
  assert.equal(
    sameOrigin(req({ host: "panel.example.com:8443", origin: "https://panel.example.com" })),
    false,
  );
});

test("sameOrigin rejects requests without Origin/Referer unless X-Requested-With is set", () => {
  assert.equal(sameOrigin(req({ host: "panel.example.com" })), false);
  assert.equal(
    sameOrigin(req({ host: "panel.example.com", "x-requested-with": "caaqil-panel" })),
    true,
  );
});

test("sameOrigin rejects malformed Origin values", () => {
  assert.equal(sameOrigin(req({ host: "panel.example.com", origin: "not-a-url" })), false);
});

test("sameOrigin rejects requests without a Host header", () => {
  assert.equal(sameOrigin(req({ origin: "https://panel.example.com" })), false);
});
