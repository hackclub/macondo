// Production only, so dev/preview environments never cancel real orders.

import { cancelHackatimeRedOrders } from "../lib/red-order-guard";
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
      const report = await cancelHackatimeRedOrders();
      if (report.cancelled > 0 || report.errors > 0) {
        console.info(
          `[cron-red-order-guard] ${source} run: scanned=${report.scanned} redBuyers=${report.redBuyers} cancelled=${report.cancelled} errors=${report.errors}`,
        );
      }
    } catch (err) {
      console.error(`[cron-red-order-guard] ${source} run failed`, err);
    }
  }

  const guardedTick = guarded("cron-red-order-guard", tick);
  startupTimer = setTimeout(() => {
    void guardedTick("startup");
    tickTimer = setInterval(() => void guardedTick("scheduled"), 30 * 60 * 1000); // every 30 minutes
  }, 60_000); // startup delay, one minute

  nitroApp.hooks.hook("close", () => {
    if (startupTimer) clearTimeout(startupTimer);
    if (tickTimer) clearInterval(tickTimer);
  });
});
