/**
 * Cron expression parsing and matching (5-field crontab syntax):
 *   minute hour day-of-month month day-of-week
 * Supports "*", "x/step" lists "a,b,c", ranges "a-b", and stepped ranges
 * "a-b/step". Day-of-week accepts 0-7 (both 0 and 7 mean Sunday).
 * Pure functions only — no I/O — so the whole module is unit testable.
 */

const FIELD_DEFS = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "dom", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "dow", min: 0, max: 7 },
] as const;

export type CronField = { name: string; values: Set<number> };
export type CronExpression = {
  fields: [CronField, CronField, CronField, CronField, CronField];
  domStar: boolean;
  dowStar: boolean;
};

export class CronError extends Error {}

function parseField(spec: string, def: (typeof FIELD_DEFS)[number]): Set<number> {
  const values = new Set<number>();
  for (const part of spec.split(",")) {
    if (!part) throw new CronError(`Empty list item in ${def.name} field`);
    let body = part;
    let step = 1;
    const slash = part.indexOf("/");
    if (slash !== -1) {
      body = part.slice(0, slash);
      step = Number(part.slice(slash + 1));
      if (!Number.isInteger(step) || step < 1) {
        throw new CronError(`Step in ${def.name} field must be a positive integer`);
      }
    }
    let start: number;
    let end: number;
    if (body === "*") {
      start = def.min;
      end = def.max;
    } else if (body.includes("-")) {
      const [a, b] = body.split("-");
      start = Number(a);
      end = Number(b);
    } else {
      start = Number(body);
      end = slash === -1 ? start : def.max; // "5/2" means start at 5, step to max
    }
    if (!Number.isInteger(start) || !Number.isInteger(end)) {
      throw new CronError(`${def.name} field has a non-numeric value: "${part}"`);
    }
    if (start < def.min || end > def.max || start > end) {
      throw new CronError(
        `${def.name} field value out of range (${def.min}-${def.max}): "${part}"`,
      );
    }
    for (let v = start; v <= end; v += step) values.add(v === 7 && def.name === "dow" ? 0 : v);
  }
  if (values.size === 0) throw new CronError(`${def.name} field matches nothing`);
  return values;
}

export function parseCron(expression: string): CronExpression {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new CronError("Use a 5-field cron expression: minute hour day month weekday.");
  }
  const fields = FIELD_DEFS.map((def, i) => ({
    name: def.name,
    values: parseField(parts[i], def),
  })) as CronExpression["fields"];

  return {
    fields,
    domStar: /^\*$/.test(parts[2]) || parts[2].startsWith("*/"),
    dowStar: /^\*$/.test(parts[4]) || parts[4].startsWith("*/"),
  };
}

/**
 * Does the expression fire at the given date?
 * Standard cron semantics: if both DOM and DOW are restricted, either may match.
 */
export function cronMatches(expression: string, date: Date): boolean {
  let parsed: CronExpression;
  try {
    parsed = parseCron(expression);
  } catch {
    return false;
  }
  const [minute, hour, dom, month, dow] = parsed.fields;
  if (!minute.values.has(date.getMinutes())) return false;
  if (!hour.values.has(date.getHours())) return false;
  if (!month.values.has(date.getMonth() + 1)) return false;

  const domHit = dom.values.has(date.getDate());
  const dowHit = dow.values.has(date.getDay());
  if (parsed.domStar && parsed.dowStar) return true;
  if (parsed.domStar) return dowHit;
  if (parsed.dowStar) return domHit;
  return domHit || dowHit;
}

/** The next `count` fire times after `from` (inclusive of the next minute boundary). */
export function nextRuns(expression: string, from: Date, count = 3): Date[] {
  const out: Date[] = [];
  const cursor = new Date(from.getTime());
  cursor.setSeconds(0, 0);
  cursor.setMinutes(cursor.getMinutes() + 1);
  const limit = 366 * 24 * 60; // never scan more than a year of minutes
  for (let i = 0; i < limit && out.length < count; i++) {
    if (cronMatches(expression, cursor)) out.push(new Date(cursor.getTime()));
    cursor.setMinutes(cursor.getMinutes() + 1);
  }
  return out;
}

const DOW_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Short human summary, e.g. "Every 5 minutes", "Daily at 03:30". */
export function describeCron(expression: string): string {
  let parsed: CronExpression;
  try {
    parsed = parseCron(expression);
  } catch (err) {
    return err instanceof CronError ? err.message : "Invalid expression";
  }
  const [m, h] = parsed.fields;
  const mArr = [...m.values].sort((a, b) => a - b);
  const hArr = [...h.values].sort((a, b) => a - b);
  const dowSet = [...parsed.fields[4].values].sort((a, b) => a - b);
  const domSet = [...parsed.fields[2].values].sort((a, b) => a - b);
  const monthSet = [...parsed.fields[3].values].sort((a, b) => a - b);

  const step = (values: number[], min: number, max: number) => {
    if (values.length > 1) {
      const stepEven = values[1] - values[0];
      if (stepEven > 1 && values.every((v, i) => i === 0 || v - values[i - 1] === stepEven)) {
        return stepEven;
      }
    }
    return values.length === max - min + 1 ? 1 : 0;
  };

  const mStep = step(mArr, 0, 59);
  if (mStep > 1 && hArr.length === 24) return `Every ${mStep} minutes`;
  if (mArr.length === 60 && hStep(hArr) > 1) return `Every ${hStep(hArr)} hours`;

  if (mArr.length === 1 && hArr.length === 1) {
    const at = `${String(hArr[0]).padStart(2, "0")}:${String(mArr[0]).padStart(2, "0")}`;
    if (domSet.length === 31 && monthSet.length === 12 && dowSet.length === 7) return `Daily at ${at}`;
    if (dowSet.length === 1 && domSet.length === 31) {
      return `Weekly on ${DOW_NAMES[dowSet[0]]} at ${at}`;
    }
    if (domSet.length === 1 && dowSet.length === 7 && monthSet.length === 12) {
      return `Monthly on day ${domSet[0]} at ${at}`;
    }
    return `At ${at}`;
  }
  return expression;
}

function hStep(values: number[]): number {
  if (values.length > 1) {
    const s = values[1] - values[0];
    if (s > 1 && values.every((v, i) => i === 0 || v - values[i - 1] === s)) return s;
  }
  return values.length === 24 ? 1 : 0;
}

/** Common presets for the UI builder. */
export const CRON_PRESETS: { label: string; expression: string }[] = [
  { label: "Every 5 minutes", expression: "*/5 * * * *" },
  { label: "Every 15 minutes", expression: "*/15 * * * *" },
  { label: "Every hour", expression: "0 * * * *" },
  { label: "Every 6 hours", expression: "0 */6 * * *" },
  { label: "Daily at 03:00", expression: "0 3 * * *" },
  { label: "Weekly (Sun 04:00)", expression: "0 4 * * 0" },
  { label: "Monthly (1st, 05:00)", expression: "0 5 1 * *" },
];
