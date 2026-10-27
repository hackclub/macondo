// Shared by the MCP tool and the HTTP handler. Caller must do the authorization check.
import { and, eq } from "drizzle-orm";
import { createError } from "h3";

import db from "../db";
import { dailyProjectActivityTable, streakDaysTable, users } from "../db/schema";
import { writeAudit } from "./audit";
import {
  dayQualifiesForProjectStreak,
  extendProjectStreaksFromHackatime,
  getUserLinkedHackatimeSecondsForDay,
  MAX_STREAK_FREEZES,
  persistRecoveredDayHackatime,
  USER_STREAK_THRESHOLD_SECONDS,
} from "./streaks";

export interface RefundStreakFreezeInput {
  userId: string;
  day: string;
  reason: string;
  actorId: string;
  via?: string;
}

export interface RefundStreakFreezeResult {
  success: true;
  day: string;
  new_status: "active";
  streak_freezes_remaining: number;
  live_seconds: number;
  stored_seconds: number;
  journal_seconds: number;
}

export async function refundStreakFreeze(
  input: RefundStreakFreezeInput,
): Promise<RefundStreakFreezeResult> {
  const { userId, actorId, via } = input;
  const day = input.day?.trim() ?? "";
  const reason = input.reason?.trim() ?? "";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    throw createError({
      statusCode: 400,
      statusMessage: "Invalid day; expected YYYY-MM-DD",
    });
  }
  if (reason.length < 3) {
    throw createError({
      statusCode: 400,
      statusMessage: "Reason required (min 3 chars)",
    });
  }

  const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!target) {
    throw createError({ statusCode: 404, statusMessage: "User not found" });
  }

  const liveSeconds = await getUserLinkedHackatimeSecondsForDay(userId, day);
  const dpaRows = await db
    .select({
      journal_seconds: dailyProjectActivityTable.journal_seconds,
      hackatime_seconds: dailyProjectActivityTable.hackatime_seconds,
    })
    .from(dailyProjectActivityTable)
    .where(
      and(
        eq(dailyProjectActivityTable.user_id, userId),
        eq(dailyProjectActivityTable.day, day),
      ),
    );
  const journalSeconds = dpaRows.reduce((s, r) => s + (r.journal_seconds ?? 0), 0);
  const storedSeconds = dpaRows.reduce((s, r) => s + (r.hackatime_seconds ?? 0), 0);

  if (
    !dayQualifiesForProjectStreak({
      liveSeconds,
      storedSeconds,
      journalSeconds,
      threshold: USER_STREAK_THRESHOLD_SECONDS,
    })
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: `Day did not qualify for streak. live=${liveSeconds}s stored=${storedSeconds}s journal=${journalSeconds}s, threshold=${USER_STREAK_THRESHOLD_SECONDS}s.`,
    });
  }

  let prevFreezes = 0;
  let newFreezes = 0;
  let prevStatus:
    | "pending"
    | "active"
    | "frozen"
    | "missed"
    | "review_protected" = "frozen";

  await db.transaction(async (tx) => {
    const [u] = await tx
      .select({ streak_freezes_remaining: users.streak_freezes_remaining })
      .from(users)
      .where(eq(users.id, userId))
      .for("update")
      .limit(1);
    if (!u) {
      throw createError({ statusCode: 404, statusMessage: "User not found" });
    }
    prevFreezes = u.streak_freezes_remaining;

    const [existing] = await tx
      .select({ status: streakDaysTable.status })
      .from(streakDaysTable)
      .where(and(eq(streakDaysTable.user_id, userId), eq(streakDaysTable.day, day)))
      .for("update")
      .limit(1);
    if (!existing) {
      throw createError({
        statusCode: 400,
        statusMessage: "No streak_days row exists for that day",
      });
    }
    prevStatus = existing.status;
    if (existing.status !== "frozen") {
      throw createError({
        statusCode: 400,
        statusMessage: `Only frozen days can be refunded (current status: ${existing.status})`,
      });
    }

    await tx
      .update(streakDaysTable)
      .set({ status: "active", seconds_logged: Math.max(liveSeconds, storedSeconds), updated_at: new Date() })
      .where(and(eq(streakDaysTable.user_id, userId), eq(streakDaysTable.day, day)));

    newFreezes = Math.min(prevFreezes + 1, MAX_STREAK_FREEZES);
    await tx
      .update(users)
      .set({ streak_freezes_remaining: newFreezes })
      .where(eq(users.id, userId));
  });

  try {
    await writeAudit({
      actor_id: actorId,
      action: "streak_freeze_refund",
      entity_type: "user",
      entity_id: userId,
      old_value: { day, prev_status: prevStatus, streak_freezes_remaining: prevFreezes },
      new_value: {
        day,
        new_status: "active",
        streak_freezes_remaining: newFreezes,
        live_seconds: liveSeconds,
        stored_seconds: storedSeconds,
        journal_seconds: journalSeconds,
        reason,
        ...(via ? { via } : {}),
      },
      sensitive: true,
      public_message: `Refunded streak freeze for ${day}: ${reason}`,
      change_summary: "streak_freeze_refund",
    });
  } catch (err) {
    console.error("Failed to write audit log for streak freeze refund", err);
  }

  // persist before the recompute so the plant walk counts this day too
  try {
    await persistRecoveredDayHackatime(userId, day, Math.max(liveSeconds, storedSeconds));
  } catch (err) {
    console.error("[refund-streak-freeze] persistRecoveredDayHackatime failed", err);
  }

  // restores per-project counters the reconcile may have cleared
  if (target.hackatime_oauth_token) {
    try {
      await extendProjectStreaksFromHackatime(
        userId,
        target.hackatime_oauth_token,
        target.timezone ?? null,
      );
    } catch (err) {
      console.error("[refund-streak-freeze] extendProjectStreaksFromHackatime failed", err);
    }
  }

  return {
    success: true,
    day,
    new_status: "active",
    streak_freezes_remaining: newFreezes,
    live_seconds: liveSeconds,
    stored_seconds: storedSeconds,
    journal_seconds: journalSeconds,
  };
}
