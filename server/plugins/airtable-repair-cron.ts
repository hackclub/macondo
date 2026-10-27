// Production only, so dev/preview environments never write to Airtable.

import { runAirtableRepair } from "../lib/airtable-repair";
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
      const result = await runAirtableRepair();
      if (result.scanned > 0 || result.errors > 0) {
        console.info(
          `[cron-airtable-repair] ${source} run: scanned=${result.scanned} repaired=${result.repaired} promoted=${result.promoted} alreadyComplete=${result.alreadyComplete} recordMissing=${result.recordMissing} errors=${result.errors}`,
        );
      }
    } catch (err) {
      console.error(`[cron-airtable-repair] ${source} run failed`, err);
    }
  }

  const guardedTick = guarded("cron-airtable-repair", tick);
  startupTimer = setTimeout(() => {
    void guardedTick("startup");
    tickTimer = setInterval(() => void guardedTick("scheduled"), 30 * 60 * 1000); // every 30 minutes
  }, 60_000); // startup delay, one minute

  nitroApp.hooks.hook("close", () => {
    if (startupTimer) clearTimeout(startupTimer);
    if (tickTimer) clearInterval(tickTimer);
  });
});
