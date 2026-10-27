// One-shot, idempotent backfill of streak_days from daily_project_activity plus raw
// journals (unioned so users without DPA rows aren't missed).

import { sql } from "drizzle-orm";
import db from "../db";
import { streakDaysTable } from "../db/schema";
import { dayQualifiesForUserStreak } from "./streak-helpers";
import { MACONDO_STREAK_START_DATE, USER_STREAK_THRESHOLD_SECONDS } from "./streaks";

export interface StreakBackfillReport {
  scanned_rows: number;
  user_days_upserted: number;
  active_days: number;
  pending_days: number;
  duration_ms: number;
}

export async function backfillStreakDays(): Promise<StreakBackfillReport> {
  const started = Date.now();

  // The journals branch buckets by UTC but streak_days.day is user-local; bucket
  // by the user's timezone before ever re-running this.
  const rows = await db.execute<{
    user_id: string;
    day: string;
    total_journal_seconds: number;
    total_hackatime_seconds: number;
    journal_project_count: number;
  }>(sql`
    WITH from_dpa AS (
      SELECT
        user_id,
        day,
        COALESCE(SUM(journal_seconds), 0)::int   AS journal_seconds,
        COALESCE(SUM(hackatime_seconds), 0)::int AS hackatime_seconds,
        SUM(CASE WHEN journal_seconds > 0 THEN 1 ELSE 0 END)::int AS journal_count
      FROM daily_project_activity
      WHERE day >= ${MACONDO_STREAK_START_DATE}
      GROUP BY user_id, day
    ),
    from_journals AS (
      SELECT
        p.user_id,
        to_char(j.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
        0::int AS journal_seconds,
        0::int AS hackatime_seconds,
        COUNT(*)::int AS journal_count
      FROM journals j
      JOIN projects p ON p.id = j.project_id
      WHERE j.archived = false
        AND to_char(j.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
          >= ${MACONDO_STREAK_START_DATE}
      GROUP BY p.user_id, day
    ),
    merged AS (
      SELECT * FROM from_dpa
      UNION ALL
      SELECT * FROM from_journals
    )
    SELECT
      user_id,
      day,
      COALESCE(SUM(journal_seconds), 0)::int   AS total_journal_seconds,
      COALESCE(SUM(hackatime_seconds), 0)::int AS total_hackatime_seconds,
      COALESCE(SUM(journal_count), 0)::int     AS journal_project_count
    FROM merged
    GROUP BY user_id, day
  `);

  // drizzle's execute return shape varies by driver
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list: Array<any> = Array.isArray(rows) ? rows : (rows as any).rows ?? [];

  let activeDays = 0;
  let pendingDays = 0;

  // On conflict we max-merge so an already-active row never regresses to pending.
  const BATCH_SIZE = 500;
  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE);
    const values = batch.map((r) => {
      const seconds = Math.max(0, Number(r.total_hackatime_seconds) || 0);
      // mirrors recordStreakDay: hackatime + journal seconds must sum to the threshold
      const meetsThreshold = dayQualifiesForUserStreak({
        hackatimeSeconds: seconds,
        journalSeconds: Math.max(0, Number(r.total_journal_seconds) || 0),
        threshold: USER_STREAK_THRESHOLD_SECONDS,
      });
      if (meetsThreshold) activeDays += 1;
      else pendingDays += 1;
      return {
        user_id: String(r.user_id),
        day: String(r.day),
        status: meetsThreshold ? ("active" as const) : ("pending" as const),
        seconds_logged: seconds,
        had_journal: Number(r.journal_project_count) > 0,
      };
    });

    if (batch.length === 0) continue;

    await db
      .insert(streakDaysTable)
      .values(values)
      .onConflictDoUpdate({
        target: [streakDaysTable.user_id, streakDaysTable.day],
        set: {
          // keep frozen/missed/review_protected set by reconcile; otherwise only upgrade to active
          status: sql`CASE
            WHEN ${streakDaysTable.status} IN ('frozen', 'missed', 'review_protected') THEN ${streakDaysTable.status}
            WHEN EXCLUDED.status = 'active' THEN 'active'::streak_day_status
            ELSE ${streakDaysTable.status}
          END`,
          seconds_logged: sql`GREATEST(${streakDaysTable.seconds_logged}, EXCLUDED.seconds_logged)`,
          had_journal: sql`${streakDaysTable.had_journal} OR EXCLUDED.had_journal`,
          updated_at: new Date(),
        },
      });
  }

  return {
    scanned_rows: list.length,
    user_days_upserted: list.length,
    active_days: activeDays,
    pending_days: pendingDays,
    duration_ms: Date.now() - started,
  };
}
