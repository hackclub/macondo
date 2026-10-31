import { syncNpsToAirtable } from "../lib/nps-airtable-sync";
import { shouldRunCronPlugins } from "../lib/cron-role";
import { guarded } from "../lib/cron-overlap";

export default defineNitroPlugin((nitroApp) => {
  if (import.meta.prerender) return;
  if (process.env.NODE_ENV !== "production") return;
  if (!shouldRunCronPlugins()) return;

  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  async function tick(source: "startup" | "scheduled"): Promise<void> {
    try {
      const result = await syncNpsToAirtable();
      if (result.synced > 0 || result.errors > 0) {
        console.info(
          `[cron-nps-airtable-sync] ${source} run: synced=${result.synced} errors=${result.errors} remaining=${result.remaining}`,
        );
      }
    } catch (err) {
      console.error(`[cron-nps-airtable-sync] ${source} run failed`, err);
    }
  }

  const guardedTick = guarded("cron-nps-airtable-sync", tick);
  startupTimer = setTimeout(() => {
    void guardedTick("startup");
    tickTimer = setInterval(() => void guardedTick("scheduled"), 30 * 60 * 1000);
  }, 90_000);

  nitroApp.hooks.hook("close", () => {
    if (startupTimer) clearTimeout(startupTimer);
    if (tickTimer) clearInterval(tickTimer);
  });
});
