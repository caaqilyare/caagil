import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CronError,
  parseCron,
  cronMatches,
  nextRuns,
  describeCron,
  CRON_PRESETS,
} from "../lib/cron";

test("parseCron accepts wildcard, step, list and range fields", () => {
  assert.doesNotThrow(() => parseCron("* * * * *"));
  assert.doesNotThrow(() => parseCron("*/5 * * * *"));
  assert.doesNotThrow(() => parseCron("0 3 * * *"));
  assert.doesNotThrow(() => parseCron("0,15,30,45 * * * *"));
  assert.doesNotThrow(() => parseCron("0 9-17 * * 1-5"));
  assert.doesNotThrow(() => parseCron("0 0 1 1 0"));
});

test("parseCron expands step and range values", () => {
  const every15 = parseCron("*/15 * * * *");
  assert.deepEqual([...every15.fields[0].values].sort((a, b) => a - b), [0, 15, 30, 45]);

  const workdays = parseCron("0 9-17 * * 1-5");
  assert.deepEqual([...workdays.fields[1].values].sort((a, b) => a - b), [9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.deepEqual([...workdays.fields[4].values].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test("parseCron maps 7 to Sunday", () => {
  const sunday = parseCron("0 0 * * 7");
  assert.ok(sunday.fields[4].values.has(0));
  assert.ok(!sunday.fields[4].values.has(7));
});

test("parseCron rejects malformed expressions with CronError", () => {
  assert.throws(() => parseCron("* * * *"), CronError);
  assert.throws(() => parseCron("60 * * * *"), CronError);
  assert.throws(() => parseCron("* 24 * * *"), CronError);
  assert.throws(() => parseCron("*/0 * * * *"), CronError);
  assert.throws(() => parseCron("abc * * * *"), CronError);
  assert.throws(() => parseCron("* * 0 * *"), CronError);
});

test("cronMatches fires at the right minute", () => {
  // 2026-06-15 03:30 local time (browser/test TZ independent: we build local).
  const at = new Date(2026, 5, 15, 3, 30, 0, 0);
  assert.equal(cronMatches("30 3 * * *", at), true);
  assert.equal(cronMatches("31 3 * * *", at), false);
  assert.equal(cronMatches("*/5 * * * *", at), true); // 30 is divisible by 5
  assert.equal(cronMatches("*/7 * * * *", at), false);
});

test("cronMatches: restricted DOM + DOW is OR (standard cron)", () => {
  // 2026-06-15 is a Monday (dow=1).
  const monday = new Date(2026, 5, 15, 0, 0, 0, 0);
  assert.equal(monday.getDay(), 1);
  // dom=15 matches; dow=5 does not → OR means match.
  assert.equal(cronMatches("0 0 15 * 5", monday), true);
  // dom=16 does not match; dow=1 matches → OR means match.
  assert.equal(cronMatches("0 0 16 * 1", monday), true);
  // Both restricted and neither matches → no fire.
  assert.equal(cronMatches("0 0 16 * 5", monday), false);
});

test("cronMatches invalid expression never fires", () => {
  assert.equal(cronMatches("not a cron", new Date()), false);
});

test("nextRuns returns increasing future fire times", () => {
  const from = new Date(2026, 0, 1, 0, 0, 0, 0); // 00:00
  const runs = nextRuns("0 3 * * *", from, 3);
  assert.equal(runs.length, 3);
  for (let i = 1; i < runs.length; i++) {
    assert.ok(runs[i].getTime() > runs[i - 1].getTime());
  }
  assert.equal(runs[0].getHours(), 3);
  assert.equal(runs[0].getMinutes(), 0);
  // Consecutive days.
  assert.equal(runs[1].getDate() - runs[0].getDate(), 1);
});

test("nextRuns handles every 5 minutes", () => {
  const from = new Date(2026, 0, 1, 10, 2, 0, 0);
  const runs = nextRuns("*/5 * * * *", from, 2);
  assert.equal(runs[0].getMinutes(), 5);
  assert.equal(runs[1].getMinutes(), 10);
});

test("describeCron gives readable summaries", () => {
  assert.match(describeCron("*/5 * * * *"), /Every 5 minutes/);
  assert.match(describeCron("0 3 * * *"), /Daily at 03:00/);
  assert.match(describeCron("0 4 * * 0"), /Weekly on Sun/);
  assert.match(describeCron("0 5 1 * *"), /Monthly on day 1/);
  // Invalid expression embeds the error message.
  assert.match(describeCron("bogus"), /5-field/);
});

test("CRON_PRESETS all parse", () => {
  for (const preset of CRON_PRESETS) {
    assert.doesNotThrow(() => parseCron(preset.expression), preset.expression);
  }
});
