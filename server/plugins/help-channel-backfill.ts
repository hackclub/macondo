// Catches help-channel posts the events webhook missed. Idempotent: mirrored messages
// are skipped by ensureTicketForSlackMessage. Dev opts in with HELP_BACKFILL_ON_START=1.

import { backfillHelpChannelTickets } from "../lib/support-ticket-backfill";
import { shouldRunCronPlugins } from "../lib/cron-role";

export default defineNitroPlugin((nitroApp) => {
  if (import.meta.prerender) return;
  const optIn = process.env.HELP_BACKFILL_ON_START === "1";
  if (process.env.NODE_ENV !== "production" && !optIn) return;
  if (!shouldRunCronPlugins()) return;

  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let running = false;

  async function tick(source: "startup" | "scheduled") {
    // Slack rate limiting can make a scan outlast the interval; don't overlap.
    if (running) return;
    running = true;
    try {
      const stats = await backfillHelpChannelTickets({
        // startup reaches back over a missed deploy window; 50 is hours of traffic
        limit: source === "startup" ? 100 : 50,
      });
      if (source === "startup" || stats.created > 0 || stats.errors > 0) {
        console.log(`[support-backfill] ${source} scan complete`, stats);
      }
    } catch (err) {
      console.error(`[support-backfill] ${source} scan crashed`, err);
    } finally {
      running = false;
    }
  }

  startupTimer = setTimeout(() => {
    void tick("startup").finally(() => {
      // shutdown may land mid-scan; don't install the interval on a closing server
      if (closed) return;
      tickTimer = setInterval(() => void tick("scheduled"), 10 * 60 * 1000); // every 10 minutes
    });
  }, 5_000); // startup delay, 5 seconds

  nitroApp.hooks.hook("close", () => {
    closed = true;
    if (startupTimer) clearTimeout(startupTimer);
    if (tickTimer) clearInterval(tickTimer);
  });
});
