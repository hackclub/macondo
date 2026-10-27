// Catches HCA reverifications for users not hitting an inline sync. Kept modest since
// canShipProject syncs on the hot path, and verified is effectively terminal.

import { and, asc, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";

import db from "../db";
import { users } from "../db/schema";
import { syncHcaIdentity } from "../lib/hca";
import { HcaRateLimitedError } from "../lib/hca-errors";
import { shouldRunCronPlugins } from "../lib/cron-role";
import { guarded } from "../lib/cron-overlap";

// HCA allows 20 token refreshes/min per IP, shared with our own logins and every other app on the orchard node.
const INTER_CALL_DELAY_MS = 6000;

async function tick(source: "startup" | "scheduled") {
  const start = Date.now();
  const cutoff = new Date(start - 4 * 60 * 60 * 1000); // only resync if last sync > 4h ago

  let rows: { id: string }[] = [];
  try {
    rows = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          ne(users.is_temp, true),
          isNotNull(users.hca_refresh_token),
          or(
            isNull(users.hca_verification_status),
            ne(users.hca_verification_status, "verified"),
          ),
          or(isNull(users.hca_last_sync_at), lt(users.hca_last_sync_at, cutoff)),
        ),
      )
      .orderBy(sql`${users.hca_last_sync_at} ASC NULLS FIRST`, asc(users.id))
      .limit(50); // batch size per tick
  } catch (err) {
    console.error(`[hca-resync-cron] ${source} batch query failed`, err);
    return;
  }

  if (rows.length === 0) {
    console.info(`[hca-resync-cron] ${source} run: 0 users to resync`);
    return;
  }

  let okCount = 0;
  let failCount = 0;
  let rateLimited = false;
  for (const row of rows) {
    try {
      if (await syncHcaIdentity(row.id, { force: true })) okCount += 1;
      else failCount += 1;
    } catch (err) {
      if (err instanceof HcaRateLimitedError) {
        // Every retry into a 429 burns budget that our logins and orchard neighbours share; resume next tick.
        rateLimited = true;
        break;
      }
      failCount += 1;
      console.error("[hca-resync-cron] syncHcaIdentity failed", row.id, err);
    }
    if (INTER_CALL_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, INTER_CALL_DELAY_MS));
    }
  }

  console.info(
    `[hca-resync-cron] ${source} run: processed ${okCount + failCount}/${rows.length} users (${okCount} ok, ${failCount} skipped/failed${rateLimited ? ", stopped on HCA 429" : ""}) in ${Date.now() - start}ms`,
  );
}

export default defineNitroPlugin((nitroApp) => {
  if (import.meta.prerender) return;
  if (process.env.NODE_ENV !== "production") return;
  if (!shouldRunCronPlugins()) return;

  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;

  const guardedTick = guarded("hca-resync-cron", tick);
  startupTimer = setTimeout(() => {
    void guardedTick("startup");
    intervalTimer = setInterval(() => void guardedTick("scheduled"), 30 * 60 * 1000); // every 30 minutes
  }, 7 * 60 * 1000); // 7 minutes after boot

  nitroApp.hooks.hook("close", () => {
    if (startupTimer) clearTimeout(startupTimer);
    if (intervalTimer) clearInterval(intervalTimer);
  });
});
