import { sql } from "drizzle-orm";

import db from "../../../db";
import { canAccessInternalSupport } from "../../../policies/internal";

// Credits the claimer (resolver only if unclaimed) and never the ticket owner, since students close their own tickets.
// Never select users.name here: it holds the legal/PII name.

export type LeaderboardEntry = {
  user_id: string;
  username: string | null;
  image: string | null;
  slack_id: string | null;
  count: number;
};

export type LeaderboardResponse = {
  all_time: LeaderboardEntry[];
  this_week: LeaderboardEntry[];
  today: LeaderboardEntry[];
};

export default defineEventHandler(async (event): Promise<LeaderboardResponse> => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalSupport(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  // resolved_at is naive UTC, so local time needs the double hop AT TIME ZONE 'UTC' AT TIME ZONE tz;
  // a single hop converts in the wrong direction.
  type Row = {
    bucket: "all_time" | "this_week" | "today";
    uid: string;
    n: number;
    username: string | null;
    image: string | null;
    slack_id: string | null;
  };
  const rows = (await db.execute(sql`
    WITH base AS (
      SELECT COALESCE(t.claimed_by_user_id, t.resolved_by_user_id) AS handler_id,
             t.resolved_at,
             COALESCE(NULLIF(u.timezone, ''), 'UTC') AS tz
      FROM support_tickets t
      JOIN users u
        ON u.id = COALESCE(t.claimed_by_user_id, t.resolved_by_user_id)
      WHERE t.status = 'resolved'
        AND t.resolved_at IS NOT NULL
        AND COALESCE(t.claimed_by_user_id, t.resolved_by_user_id) <> t.user_id
    ),
    all_time AS (
      SELECT handler_id AS uid, COUNT(*)::int AS n
      FROM base
      GROUP BY 1
      ORDER BY n DESC
      LIMIT 10
    ),
    this_week AS (
      SELECT handler_id AS uid, COUNT(*)::int AS n
      FROM base
      WHERE resolved_at AT TIME ZONE 'UTC' AT TIME ZONE tz
            >= date_trunc('week', NOW() AT TIME ZONE tz)
      GROUP BY 1
      ORDER BY n DESC
      LIMIT 10
    ),
    today AS (
      SELECT handler_id AS uid, COUNT(*)::int AS n
      FROM base
      WHERE date_trunc('day', resolved_at AT TIME ZONE 'UTC' AT TIME ZONE tz)
            = date_trunc('day', NOW() AT TIME ZONE tz)
      GROUP BY 1
      ORDER BY n DESC
      LIMIT 10
    )
    SELECT
      x.bucket, x.uid, x.n,
      u.username, u.image, u.slack_id
    FROM (
      SELECT 'all_time'::text AS bucket, uid, n FROM all_time
      UNION ALL SELECT 'this_week'::text, uid, n FROM this_week
      UNION ALL SELECT 'today'::text, uid, n FROM today
    ) x
    JOIN users u ON u.id = x.uid
    ORDER BY x.bucket, x.n DESC
  `)) as unknown as Row[];

  const result: LeaderboardResponse = {
    all_time: [],
    this_week: [],
    today: [],
  };
  for (const row of rows) {
    const entry: LeaderboardEntry = {
      user_id: row.uid,
      username: row.username,
      image: row.image,
      slack_id: row.slack_id,
      count: Number(row.n),
    };
    if (row.bucket === "all_time") result.all_time.push(entry);
    else if (row.bucket === "this_week") result.this_week.push(entry);
    else if (row.bucket === "today") result.today.push(entry);
  }

  return result;
});
