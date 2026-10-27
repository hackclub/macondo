// Production only so dev/preview never touch real tickets; test via /api/internal/cron/support-auto-resolve.

import { runAutoResolveSweep } from "../lib/support-ticket-auto-resolve";
import { shouldRunCronPlugins } from "../lib/cron-role";
import { guarded } from "../lib/cron-overlap";

export default defineNitroPlugin((nitroApp) => {
  if (import.meta.prerender) return;
  if (process.env.NODE_ENV !== "production") return;
  if (!shouldRunCronPlugins()) return;

  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  async function tick(source: "startup" | "scheduled") {
    try {
      const result = await runAutoResolveSweep();
      if (result.warned > 0 || result.resolved > 0 || result.errors > 0) {
        console.info(
          `[cron-auto-resolve] ${source} run: cleared=${result.cleared} warned=${result.warned} resolved=${result.resolved} errors=${result.errors}`,
        );
      }
    } catch (err) {
      console.error(`[cron-auto-resolve] ${source} run failed`, err);
    }
  }

  const guardedTick = guarded("support-auto-resolve", tick);
  startupTimer = setTimeout(() => {
    void guardedTick("startup");
    tickTimer = setInterval(() => void guardedTick("scheduled"), 60 * 60 * 1000);
  }, 45_000); // startup delay, 45 seconds

  nitroApp.hooks.hook("close", () => {
    if (startupTimer) clearTimeout(startupTimer);
    if (tickTimer) clearInterval(tickTimer);
  });
});
