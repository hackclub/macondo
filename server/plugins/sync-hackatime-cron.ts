// The active pass is hourly because the batch is event-loop heavy and faster cadences
// slowed the site. Safe across replicas: the sync is idempotent with per-user locks.

import {
  runBatchHackatimeSync,
  type BatchSyncSource,
} from "../lib/hackatime-batch-sync";
import { shouldRunCronPlugins } from "../lib/cron-role";
import { guarded } from "../lib/cron-overlap";
import { macondoHasEnded } from "../lib/macondo-end";

function recentActiveSince(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 2);
  return d.toISOString().slice(0, 10);
}

export default defineNitroPlugin((nitroApp) => {
  if (import.meta.prerender) return;
  if (process.env.NODE_ENV !== "production") return;
  if (!shouldRunCronPlugins()) return;

  let dailyTimer: ReturnType<typeof setInterval> | null = null;
  let activeTimer: ReturnType<typeof setInterval> | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;

  async function tick(source: BatchSyncSource, activeSince?: string) {
    // Synced hours only fed streaks and shipping, both over; the admin "sync all" job still works.
    if (macondoHasEnded()) return;
    try {
      const report = await runBatchHackatimeSync({ source, activeSince });
      console.info(
        `[cron-sync-hackatime] ${source} run: ${report.synced}/${report.scanned} users in ${report.duration_ms}ms (${report.project_streaks_extended} project streaks, ${report.ships_resnapshotted} ships resnapped, ${report.failed} failed)`,
      );
    } catch (err) {
      console.error(`[cron-sync-hackatime] ${source} run failed`, err);
    }
  }

  // One shared guard on purpose: overlapping daily and active runs doubles the working set.
  const guardedTick = guarded("hackatime-sync", tick);
  startupTimer = setTimeout(() => {
    void guardedTick("startup");
    dailyTimer = setInterval(() => void guardedTick("scheduled"), 24 * 60 * 60 * 1000);
    activeTimer = setInterval(
      () => void guardedTick("scheduled_active", recentActiveSince()),
      60 * 60 * 1000, // recently-active users, hourly
    );
  }, 30_000);

  nitroApp.hooks.hook("close", () => {
    if (startupTimer) clearTimeout(startupTimer);
    if (dailyTimer) clearInterval(dailyTimer);
    if (activeTimer) clearInterval(activeTimer);
  });
});
