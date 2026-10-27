// Retries only 'unreachable'/'error' (failed POSTs); NULL, skipped_* and invalid_payload
// belong to other flows. Racing a live push is safe: ARI answers 409 already_queued.

import { and, asc, inArray, isNull } from "drizzle-orm";

import db from "../db";
import { shipTable } from "../db/schema";
import { isAriEnabled } from "../lib/app-settings";
import { pushShipToAriAndRecord } from "../lib/ari-client";
import { guarded } from "../lib/cron-overlap";
import { shouldRunCronPlugins } from "../lib/cron-role";

export default defineNitroPlugin((nitroApp) => {
  if (import.meta.prerender) return;
  if (process.env.NODE_ENV !== "production") return;
  if (!shouldRunCronPlugins()) return;

  let startupTimer: ReturnType<typeof setTimeout> | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  async function tick(source: "startup" | "scheduled"): Promise<void> {
    try {
      if (!(await isAriEnabled())) return;

      const stranded = await db
        .select({ id: shipTable.id })
        .from(shipTable)
        .where(
          and(
            inArray(shipTable.status, ["under_review", "pending_second_pass"]),
            isNull(shipTable.ari_submission_id),
            inArray(shipTable.ari_status, ["unreachable", "error"]),
          ),
        )
        .orderBy(asc(shipTable.id))
        .limit(25); // per-tick cap, bounded even if ARI is down
      if (stranded.length === 0) return;

      let recovered = 0;
      for (const { id } of stranded) {
        if ((await pushShipToAriAndRecord(id, { backdate: true }))?.ok) recovered += 1;
      }
      console.info(
        `[cron-ari-retry] ${source} run: stranded=${stranded.length} recovered=${recovered}`,
      );
    } catch (err) {
      console.error(`[cron-ari-retry] ${source} run failed`, err);
    }
  }

  const guardedTick = guarded("cron-ari-retry", tick);
  startupTimer = setTimeout(() => {
    void guardedTick("startup");
    tickTimer = setInterval(() => void guardedTick("scheduled"), 15 * 60 * 1000); // every 15 minutes
  }, 90_000); // startup delay, 90 seconds

  nitroApp.hooks.hook("close", () => {
    if (startupTimer) clearTimeout(startupTimer);
    if (tickTimer) clearInterval(tickTimer);
  });
});
