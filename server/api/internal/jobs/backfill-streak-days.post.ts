import { runBatchHackatimeSync } from "../../../lib/hackatime-batch-sync";
import { backfillStreakDays } from "../../../lib/streak-backfill";
import { tryAcquireLock, writeJobStatus } from "../../../lib/admin-job";
import { hasRole } from "../../../policies/internal";
import type { users } from "../../../db/schema";

// Seeding then a clean-slate sync are chained so one press fixes every user, even past a poisoned Redis delta.
// Runs for minutes, so it's fire-and-forget behind a Redis lock; the GET endpoint reports status.

const STATUS_NAME = "backfill-streak-days";

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
      const seedReport = await backfillStreakDays();
      const recomputeReport = await runBatchHackatimeSync({
        source: "manual",
        forceClean: true,
      });
      const durationMs = Date.now() - startedAt;
      await writeJobStatus(STATUS_NAME, {
        ok: true,
        ranAt: new Date().toISOString(),
        durationMs,
        report: {
          ...seedReport,
          recompute: {
            scanned: recomputeReport.scanned,
            synced: recomputeReport.synced,
            failed: recomputeReport.failed,
            project_streaks_extended: recomputeReport.project_streaks_extended,
            duration_ms: recomputeReport.duration_ms,
          },
        },
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
