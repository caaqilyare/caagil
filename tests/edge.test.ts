import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeRel } from "../lib/files";
import { normalizeDomain, normalizeIp, isIpAddress, renderPanelEdge } from "../lib/edge";

test("normalizeRel keeps clean absolute paths", () => {
  assert.equal(normalizeRel("/"), "/");
  assert.equal(normalizeRel("/wp-content/uploads"), "/wp-content/uploads");
  assert.equal(normalizeRel("wp-content/uploads"), "/wp-content/uploads");
  assert.equal(normalizeRel(""), "/");
  assert.equal(normalizeRel(null as unknown as string), "/");
});

test("normalizeRel collapses dots and backslashes", () => {
  assert.equal(normalizeRel("/a/./b"), "/a/b");
  assert.equal(normalizeRel("\\a\\b"), "/a/b");
  assert.equal(normalizeRel("//a///b//"), "/a/b");
});

test("normalizeRel rejects traversal attempts", () => {
  assert.throws(() => normalizeRel("/../../etc/passwd"));
  assert.throws(() => normalizeRel("a/../.."));
  assert.throws(() => normalizeRel(".."));
});

test("normalizeDomain strips scheme, path and trailing dot", () => {
  assert.equal(normalizeDomain("Panel.Example.com"), "panel.example.com");
  assert.equal(normalizeDomain("https://panel.example.com/"), "panel.example.com");
  assert.equal(normalizeDomain("panel.example.com/path"), "panel.example.com");
  assert.equal(normalizeDomain("panel.example.com."), "panel.example.com");
});

test("normalizeDomain rejects IPs and malformed hosts", () => {
  assert.throws(() => normalizeDomain("203.0.113.10"));
  assert.throws(() => normalizeDomain(""));
  assert.throws(() => normalizeDomain("not a domain"));
  assert.throws(() => normalizeDomain("-bad.example.com"));
});

test("normalizeIp validates IPv4", () => {
  assert.equal(normalizeIp("203.0.113.10"), "203.0.113.10");
  assert.throws(() => normalizeIp("999.1.1.1"));
  assert.throws(() => normalizeIp("panel.example.com"));
});

test("isIpAddress range checks", () => {
  assert.equal(isIpAddress("0.0.0.0"), true);
  assert.equal(isIpAddress("255.255.255.255"), true);
  assert.equal(isIpAddress("256.0.0.0"), false);
  assert.equal(isIpAddress("1.2.3"), false);
});

test("renderPanelEdge emits a Host router for the domain", () => {
  const yaml = renderPanelEdge({ domain: "panel.example.com", ip: null, allowIp: false });
  assert.match(yaml, /Host\(`panel\.example\.com`\)/);
  assert.match(yaml, /caaqil-panel/);
});

test("renderPanelEdge emits the IP router when allowIp is on", () => {
  const yaml = renderPanelEdge({ domain: null, ip: "203.0.113.10", allowIp: true });
  assert.match(yaml, /203\.0\.113\.10/);
});
