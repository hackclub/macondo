import { runBatchHackatimeSync } from "../../../lib/hackatime-batch-sync";
import { tryAcquireLock, writeJobStatus } from "../../../lib/admin-job";
import { hasRole } from "../../../policies/internal";
import type { users } from "../../../db/schema";

// Takes minutes, so it's fire-and-forget; the lock is shared with backfill-streak-days since both force-clean sync.

const STATUS_NAME = "sync-hackatime-all";

export default defineEventHandler(async (event) => {
  const actor = event.context.user as
    | (typeof users.$inferSelect)
    | null
    | undefined;

  if (!actor || !hasRole(actor, ["supaadmin"])) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const lock = await tryAcquireLock("hackatime-batch-sync");
  if (!lock.ok) {
    if (lock.reason === "already_running") {
      setResponseStatus(event, 409);
      return { status: "already_running" as const };
    }
    setResponseStatus(event, 503);
    return { status: "redis_unavailable" as const };
  }

  const startedAt = Date.now();
  console.info(`[admin-job] ${STATUS_NAME} started actor=${actor.id}`);

  void (async () => {
    try {
      const report = await runBatchHackatimeSync({
        source: "manual",
        forceClean: true,
      });
      const durationMs = Date.now() - startedAt;
      await writeJobStatus(STATUS_NAME, {
        ok: true,
        ranAt: new Date().toISOString(),
        durationMs,
        report,
      });
      console.info(`[admin-job] ${STATUS_NAME} done in ${durationMs}ms`);
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      console.error(`[admin-job] ${STATUS_NAME} failed`, err);
      await writeJobStatus(STATUS_NAME, {
        ok: false,
        ranAt: new Date().toISOString(),
        durationMs,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      await lock.release();
    }
  })();

  setResponseStatus(event, 202);
  return { status: "started" as const };
});
