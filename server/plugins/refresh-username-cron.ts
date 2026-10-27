// Username and avatar are only captured at sign-in, so Slack renames would otherwise go stale.
// username stays Slack-handle-only; anything else leaks PII onto public surfaces.

import { and, asc, eq, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";

import db from "../db";
import { users } from "../db/schema";
import { fetchSlackHandle, fetchSlackProfile } from "../lib/slack";
import { shouldRunCronPlugins } from "../lib/cron-role";
import { guarded } from "../lib/cron-overlap";

const INTER_CALL_DELAY_MS = 1200; // stays under slack users.info rate limit

async function tick(source: "startup" | "scheduled") {
  const start = Date.now();
  const cutoff = new Date(start - 7 * 24 * 60 * 60 * 1000);

  let rows: {
    id: string;
    username: string | null;
    image: string | null;
    slack_id: string | null;
  }[] = [];
  try {
    rows = await db
      .select({
        id: users.id,
        username: users.username,
        image: users.image,
        slack_id: users.slack_id,
      })
      .from(users)
      .where(
        and(
          ne(users.is_temp, true),
          isNotNull(users.slack_id),
          or(
            isNull(users.username_synced_at),
            lt(users.username_synced_at, cutoff),
          ),
        ),
      )
      .orderBy(sql`${users.username_synced_at} ASC NULLS FIRST`, asc(users.id))
      .limit(100); // batch size per tick
  } catch (err) {
    console.error(`[refresh-username-cron] ${source} batch query failed`, err);
    return;
  }

  if (rows.length === 0) {
    console.info(`[refresh-username-cron] ${source} run: 0 users to refresh`);
    return;
  }

  let changed = 0;
  for (const row of rows) {
    if (!row.slack_id) continue;
    try {
      const [handle, profile] = await Promise.all([
        fetchSlackHandle(row.slack_id),
        fetchSlackProfile(row.slack_id),
      ]);
      const updates: Partial<{
        username: string;
        image: string;
        username_synced_at: Date;
      }> = { username_synced_at: new Date() };
      // never clobber an existing value with a failed (null) lookup
      if (handle && handle !== row.username) updates.username = handle;
      if (profile.image && profile.image !== row.image) {
        updates.image = profile.image;
      }
      await db.update(users).set(updates).where(eq(users.id, row.id));
      if (updates.username !== undefined || updates.image !== undefined) {
        changed += 1;
      }
    } catch (err) {
      console.error("[refresh-username-cron] refresh failed", row.id, err);
      // stamp anyway so a persistently failing user doesn't wedge the queue front
      try {
        await db
          .update(users)
          .set({ username_synced_at: new Date() })
          .where(eq(users.id, row.id));
      } catch {
        // ignore
      }
    }
    if (INTER_CALL_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, INTER_CALL_DELAY_MS));
    }
  }

  console.info(
    `[refresh-username-cron] ${source} run: processed ${rows.length} users (${changed} updated) in ${Date.now() - start}ms`,
  );
}

export default defineNitroPlugin((nitroApp) => {
  if (import.meta.prerender) return;
  if (process.env.NODE_ENV !== "production") return;
  if (!shouldRunCronPlugins()) return;

  let intervalTimer: ReturnType<typeof setInterval> | null = null;
  let startupTimer: ReturnType<typeof setTimeout> | null = null;

  const guardedTick = guarded("refresh-username-cron", tick);
  startupTimer = setTimeout(() => {
    void guardedTick("startup");
    intervalTimer = setInterval(() => void guardedTick("scheduled"), 6 * 60 * 60 * 1000); // every 6 hours
  }, 9 * 60 * 1000); // 9 minutes after boot

  nitroApp.hooks.hook("close", () => {
    if (startupTimer) clearTimeout(startupTimer);
    if (intervalTimer) clearInterval(intervalTimer);
  });
});
