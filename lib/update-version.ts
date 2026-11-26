/**
 * Pure helpers for deciding whether the running panel build is behind
 * origin/main. Kept separate from `lib/updater.ts` so they can be unit tested
 * without a Docker daemon.
 */

/** Commits are equal when identical, or when one is a short SHA of the other. */
export function sameCommit(a: string, b: string): boolean {
  if (!a || !b || a === "unknown" || b === "unknown") return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/**
 * True when a newer build is available.
 *
 * A build with no commit metadata (`unknown`, e.g. an install created before
 * the build arg existed) cannot be compared, so it is offered the update: the
 * rebuild writes `CAAQIL_COMMIT` and later checks are exact. This is what lets
 * older installs pull the new UI from inside the panel instead of being stuck
 * on "Version unknown".
 */
export function isUpdateAvailable(current: string, latest: string | null): boolean {
  if (!latest) return false;
  if (!current || current === "unknown") return true;
  return !sameCommit(current, latest);
}
