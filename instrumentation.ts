/**
 * Next.js instrumentation hook. Starts the background scheduler once per
 * server process: cron job execution, metrics sampling and housekeeping.
 *
 * The interval is deliberately 30 seconds (cron matching itself is per-minute
 * and idempotent) so a restart never skips a due minute for long.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Tests and one-off scripts should not start timers.
  if (process.env.CAAQIL_DISABLE_SCHEDULER === "1") return;

  const { schedulerTick } = await import("./lib/scheduler");

  let running = false;
  const tick = async () => {
    if (running) return; // never overlap ticks
    running = true;
    try {
      await schedulerTick();
    } catch (err) {
      console.error("[scheduler]", err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  };

  // First tick shortly after boot, then every 30 seconds. unref so the timer
  // never keeps the process alive on its own.
  setTimeout(tick, 5_000).unref?.();
  const timer = setInterval(tick, 30_000);
  timer.unref?.();
}