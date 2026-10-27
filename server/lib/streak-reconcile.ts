import { and, eq, gte, inArray, isNotNull, isNull } from "drizzle-orm";
import db from "../db";
import { shipTable, streakDaysTable, users } from "../db/schema";
import {
  REVIEW_LOOP_SHIP_STATUSES,
  backfillReviewProtectionGaps,
  backfillStrandedPendingFreezes,
  reconcileFreezesIfStale,
  reconcileOptedOutIdleProjects,
  refundFrozenDaysWithLateActivity,
} from "./streaks";

export interface ReconcileResult {
  user_id: string;
  freezes_consumed: number;
  streak_broken: boolean;
}

export async function reconcileMissedDays(
  userId: string,
): Promise<ReconcileResult | null> {
  const before = await db
    .select({ streak_freezes_remaining: users.streak_freezes_remaining })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!before.length) return null;
  const result = await reconcileFreezesIfStale(userId);
  return {
    user_id: userId,
    freezes_consumed: Math.max(
      0,
      before[0]!.streak_freezes_remaining - result.streak_freezes_remaining,
    ),
    streak_broken: result.reset,
  };
}

export async function reconcileAllActiveUsers(): Promise<{
  scanned: number;
  reconciled: number;
  broken: number;
  freezes_consumed: number;
  freezes_refunded: number;
}> {
  const sinceDay = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const targets = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(isNotNull(users.last_active_date), gte(users.last_active_date, sinceDay)),
    );

  let reconciled = 0;
  let broken = 0;
  let freezesConsumed = 0;
  let freezesRefunded = 0;

  // Users run concurrently since each reconcile holds a per-user advisory lock. Visit every user:
  // reconcile also breaks zero-freeze streaks, so skipping anyone risks a missed break.
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < targets.length) {
      const t = targets[cursor++]!;
      try {
        const r = await reconcileMissedDays(t.id);
        if (r && (r.freezes_consumed > 0 || r.streak_broken)) {
          reconciled += 1;
          if (r.streak_broken) broken += 1;
          freezesConsumed += r.freezes_consumed;
        }
      } catch (err) {
        console.error(`[streak-reconcile] failed for user ${t.id}`, err);
      }

      try {
        const refund = await refundFrozenDaysWithLateActivity(t.id, {});
        freezesRefunded += refund.refunded.length;
      } catch (err) {
        console.error(`[streak-reconcile] late-activity refund failed for user ${t.id}`, err);
      }

      // Covers journal-only opted-out projects, which the hackatime recompute never walks.
      try {
        await reconcileOptedOutIdleProjects(t.id);
      } catch (err) {
        console.error(
          `[streak-reconcile] opted-out idle sweep failed for user ${t.id}`,
          err,
        );
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(8, targets.length) }, () => worker()), // concurrent reconcile workers
  );

  return {
    scanned: targets.length,
    reconciled,
    broken,
    freezes_consumed: freezesConsumed,
    freezes_refunded: freezesRefunded,
  };
}

/**
 * Iterates users holding an open-review ship rather than the recently-active set, since a long
 * queue can outlast the 14-day window above.
 */
export async function reconcileOpenReviewProtection(opts?: {
  actorId?: string;
  dryRun?: boolean;
  lookbackDays?: number;
}): Promise<{
  scanned: number;
  users_healed: number;
  days_protected: number;
  freezes_refunded: number;
}> {
  const targets = await db
    .selectDistinct({ user_id: shipTable.user_id })
    .from(shipTable)
    .where(
      and(
        inArray(shipTable.status, REVIEW_LOOP_SHIP_STATUSES),
        isNull(shipTable.reviewed_at),
      ),
    );

  let usersHealed = 0;
  let daysProtected = 0;
  let freezesRefunded = 0;
  for (const t of targets) {
    try {
      const r = await backfillReviewProtectionGaps(t.user_id, opts);
      if (r.protectedDays.length > 0) {
        usersHealed += 1;
        daysProtected += r.protectedDays.length;
        freezesRefunded += r.refundedFreezes;
      }
    } catch (err) {
      console.error(
        `[streak-reconcile] open-review protection backfill failed for user ${t.user_id}`,
        err,
      );
    }
  }

  return {
    scanned: targets.length,
    users_healed: usersHealed,
    days_protected: daysProtected,
    freezes_refunded: freezesRefunded,
  };
}

/** Only users with a recent pending row can carry a stranded hole, so this beats scanning every active user. */
export async function reconcileStrandedPendingFreezes(opts?: {
  actorId?: string;
  dryRun?: boolean;
  lookbackDays?: number;
  // Net-zero goodwill comp instead of a real burn; for the historical backlog, not the daily cron.
  comp?: boolean;
}): Promise<{
  scanned: number;
  users_healed: number;
  days_frozen: number;
  freezes_consumed: number;
  unresolved_no_freeze: number;
}> {
  const sinceDay = new Date(Date.now() - (opts?.lookbackDays ?? 60) * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  // Coarse UTC day filter for candidates; the per-user heal does the precise local-day logic.
  const targets = await db
    .selectDistinct({ user_id: streakDaysTable.user_id })
    .from(streakDaysTable)
    .where(
      and(
        eq(streakDaysTable.status, "pending"),
        gte(streakDaysTable.day, sinceDay),
      ),
    );

  let usersHealed = 0;
  let daysFrozen = 0;
  let freezesConsumed = 0;
  let unresolved = 0;
  for (const t of targets) {
    try {
      const r = await backfillStrandedPendingFreezes(t.user_id, opts);
      if (r.frozenDays.length > 0) {
        usersHealed += 1;
        daysFrozen += r.frozenDays.length;
        freezesConsumed += r.freezesConsumed;
      }
      unresolved += r.unresolvedNoFreeze.length;
    } catch (err) {
      console.error(
        `[streak-reconcile] stranded-pending freeze backfill failed for user ${t.user_id}`,
        err,
      );
    }
  }

  return {
    scanned: targets.length,
    users_healed: usersHealed,
    days_frozen: daysFrozen,
    freezes_consumed: freezesConsumed,
    unresolved_no_freeze: unresolved,
  };
}
