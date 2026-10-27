import { sql } from "drizzle-orm";
import db from "../../../db";
import { canAccessInternalStats } from "../../../policies/internal";

// Only use saved timezone names supported by this PostgreSQL instance; otherwise use UTC.
// Weeks are bucketed in each author's timezone; created_at is naive UTC, hence the double AT TIME ZONE.
// The series ends at GREATEST(current EST week, latest bucket) so authors east of UTC aren't dropped.

type WeeklyRow = {
  week_start: string;
  response_count: number | string | null;
  promoters: number | string | null;
  passives: number | string | null;
  detractors: number | string | null;
  score_sum: number | string | null;
};

export type NpsWeeklyPoint = {
  weekStart: string;
  responseCount: number;
  promoters: number;
  passives: number;
  detractors: number;
  scoreSum: number;
  nps: number | null;
  avgScore: number | null;
};

export type NpsWeeklyResponse = {
  weeks: NpsWeeklyPoint[];
  generatedAt: string;
};

export default defineEventHandler(async (event): Promise<NpsWeeklyResponse> => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalStats(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const result = await db.execute(sql`
    WITH responses AS (
      SELECT r.id, r.score,
             date_trunc('week', r.created_at AT TIME ZONE 'UTC'
               AT TIME ZONE COALESCE(tz.name, 'UTC')) AS local_week
      FROM nps_responses r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN pg_timezone_names tz ON lower(tz.name) = lower(u.timezone)
    ),
    bounds AS (
      SELECT
        min(local_week) AS first_week,
        GREATEST(
          max(local_week),
          date_trunc('week', now() AT TIME ZONE 'EST')::timestamp
        ) AS last_week
      FROM responses
    ),
    weeks AS (
      SELECT generate_series(b.first_week, b.last_week, interval '7 days') AS week
      FROM bounds b
      WHERE b.first_week IS NOT NULL
    )
    SELECT
      to_char(w.week, 'YYYY-MM-DD') AS week_start,
      count(r.id)::int AS response_count,
      count(r.id) FILTER (WHERE r.score >= 9)::int AS promoters,
      count(r.id) FILTER (WHERE r.score >= 7 AND r.score < 9)::int AS passives,
      count(r.id) FILTER (WHERE r.score <= 6)::int AS detractors,
      COALESCE(sum(r.score), 0)::int AS score_sum
    FROM weeks w
    LEFT JOIN responses r ON r.local_week = w.week
    GROUP BY w.week
    ORDER BY w.week ASC
  `);

  const rows =
    (result as unknown as { rows?: WeeklyRow[] }).rows ??
    (result as unknown as WeeklyRow[]);

  return {
    weeks: rows.map((row) => {
      const responseCount = Number(row.response_count ?? 0);
      const promoters = Number(row.promoters ?? 0);
      const passives = Number(row.passives ?? 0);
      const detractors = Number(row.detractors ?? 0);
      const scoreSum = Number(row.score_sum ?? 0);
      return {
        weekStart: row.week_start,
        responseCount,
        promoters,
        passives,
        detractors,
        scoreSum,
        nps:
          responseCount > 0
            ? Math.round(((promoters - detractors) / responseCount) * 100)
            : null,
        avgScore: responseCount > 0 ? scoreSum / responseCount : null,
      };
    }),
    generatedAt: new Date().toISOString(),
  };
});
