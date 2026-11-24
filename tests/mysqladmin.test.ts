import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DB_NAME_RE,
  DB_USER_RE,
  quoteIdent,
  validateDbName,
  validateDbUser,
  parseMysqlRows,
} from "../lib/mysqladmin";

test("validateDbName accepts panel-style names", () => {
  assert.equal(validateDbName("wp_blog"), "wp_blog");
  assert.equal(validateDbName("  App_DB_1  "), "app_db_1");
  assert.equal(validateDbName("a"), "a");
  assert.equal(validateDbName("x" + "y".repeat(62)), "x" + "y".repeat(62));
});

test("validateDbName rejects injection and malformed names", () => {
  const bad = [
    "",
    "1abc", // starts with a digit
    "_abc", // starts with underscore
    "has space",
    "has-dash",
    "has.dot",
    "tab\tname",
    "quote'name",
    'double"quote',
    "backtick`name",
    "semi;colon",
    "drop table users", // spaces rejected anyway
    "a".repeat(64), // too long
  ];
  for (const name of bad) {
    assert.throws(() => validateDbName(name), `"${name}" must be rejected`);
  }
  // Uppercase is normalized to lowercase, so it stays valid.
  assert.equal(validateDbName("UPPER_lower"), "upper_lower");
});

test("validateDbUser accepts valid names and rejects invalid", () => {
  assert.equal(validateDbUser("blog_user"), "blog_user");
  assert.throws(() => validateDbUser("way-too-long-" + "x".repeat(40)));
  assert.throws(() => validateDbUser("has space"));
  assert.throws(() => validateDbUser("1abc"));
  assert.throws(() => validateDbUser(""));
});

test("quoteIdent wraps validated identifiers and rejects unsafe ones", () => {
  assert.equal(quoteIdent("wp_blog"), "`wp_blog`");
  assert.equal(quoteIdent("x9_y"), "`x9_y`");
  assert.throws(() => quoteIdent("wp;drop"));
  assert.throws(() => quoteIdent(""));
  assert.throws(() => quoteIdent("UPPER"));
  assert.throws(() => quoteIdent("a`b"));
});

test("DB_NAME_RE and DB_USER_RE guard lengths", () => {
  assert.ok(DB_NAME_RE.test("a"));
  assert.ok(!DB_NAME_RE.test(""));
  assert.ok(DB_USER_RE.test("u"));
  assert.ok(!DB_USER_RE.test("a".repeat(32)));
});

test("parseMysqlRows splits tab-separated mysql -N -B output", () => {
  const text = "wp_blog\t12.5\t8\nwp_shop\t3.0\t42\n";
  assert.deepEqual(parseMysqlRows(text), [
    ["wp_blog", "12.5", "8"],
    ["wp_shop", "3.0", "42"],
  ]);
});

test("parseMysqlRows drops empty lines and handles single columns", () => {
  assert.deepEqual(parseMysqlRows("8.0.36\n\n"), [["8.0.36"]]);
  assert.deepEqual(parseMysqlRows(""), []);
});
