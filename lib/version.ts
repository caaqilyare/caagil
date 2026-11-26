export const CAAQIL_VERSION = "1.6.0.5";

/**
 * Release versioning rule: every release increments the last segment by one.
 *  1.6.0.1 -> 1.6.0.2 -> 1.6.0.3 …
 * A three-segment version gets `.1` appended on the next release. Segments are
 * never skipped. `scripts/next-version.mjs` applies this automatically.
 */
export function nextVersion(current: string): string {
  const match = current.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw new Error(`Invalid version "${current}" — expected 1.2.3 or 1.2.3.4.`);
  }
  const build = match[4] ? Number(match[4]) + 1 : 1;
  return `${match[1]}.${match[2]}.${match[3]}.${build}`;
}
