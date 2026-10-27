// Non-graceful shutdowns leave admin-job Redis locks alive for up to 90 min; on boot
// none are held, so any left are stale. Startup-only so live locks are never yanked.

import { shouldRunCronPlugins } from "../lib/cron-role";
import { clearAllAdminJobLocks } from "../lib/admin-job";

export default defineNitroPlugin(() => {
  if (!shouldRunCronPlugins()) return;
  if (import.meta.prerender) return;
  void (async () => {
    try {
      const result = await clearAllAdminJobLocks();
      if (result.cleared > 0) {
        console.info(
          `[admin-job-startup] cleared ${result.cleared} stale lock(s): ${result.keys.join(", ")}`,
        );
      } else {
        console.info("[admin-job-startup] no stale locks");
      }
    } catch (err) {
      console.warn("[admin-job-startup] failed to clear stale locks", err);
    }
  })();
});
