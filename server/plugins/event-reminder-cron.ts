// Production only so dev/preview never DM real users; test via /api/internal/cron/event-reminders.

import { runEventReminderSweep } from "../lib/event-reminders";
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
      const r = await runEventReminderSweep();
      if (r.sent > 0 || r.errors > 0) {
        console.info(
          `[cron-event-reminder] ${source} run: scanned=${r.scanned} sent=${r.sent} skipped=${r.skipped} errors=${r.errors}`,
        );
      }
    } catch (err) {
      console.error(`[cron-event-reminder] ${source} run failed`, err);
    }
  }

  const guardedTick = guarded("event-reminder-cron", tick);
  startupTimer = setTimeout(() => {
    void guardedTick("startup");
    tickTimer = setInterval(() => void guardedTick("scheduled"), 5 * 60 * 1000); // every 5 minutes
  }, 45_000); // startup delay, 45 seconds

  nitroApp.hooks.hook("close", () => {
    if (startupTimer) clearTimeout(startupTimer);
    if (tickTimer) clearInterval(tickTimer);
  });
});
