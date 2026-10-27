// Production only, so dev/preview environments don't seed garbage snapshot rows.

import { captureYesterdayDauSnapshot } from "../lib/dau-snapshot";
import { shouldRunCronPlugins } from "../lib/cron-role";
import { guarded } from "../lib/cron-overlap";

export default defineNitroPlugin((nitroApp) => {
  if (import.meta.prerender) return;
  if (process.env.NODE_ENV !== "production") return;
  if (!shouldRunCronPlugins()) return;

  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let dailyTimer: ReturnType<typeof setInterval> | null = null;

  async function snapshotTick(source: "startup" | "scheduled") {
    try {
      const result = await captureYesterdayDauSnapshot();
      console.info(
        `[cron-dau-snapshot] ${source} run: captured day=${result.day} count=${result.count}`,
      );
    } catch (err) {
      console.error(`[cron-dau-snapshot] ${source} run failed`, err);
    }
  }

  const guardedSnapshotTick = guarded("cron-dau-snapshot", snapshotTick);
  startupTimer = setTimeout(() => {
    void guardedSnapshotTick("startup");
    dailyTimer = setInterval(() => void guardedSnapshotTick("scheduled"), 24 * 60 * 60 * 1000);
  }, 60_000); // startup delay, one minute

  nitroApp.hooks.hook("close", () => {
    if (startupTimer) clearTimeout(startupTimer);
    if (dailyTimer) clearInterval(dailyTimer);
  });
});
