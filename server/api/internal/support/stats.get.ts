import { sql } from "drizzle-orm";

import db from "../../../db";
import { supportTicketTable } from "../../../db/schema";
import { canAccessInternalSupport } from "../../../policies/internal";

export default defineEventHandler(async (event) => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalSupport(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const statusRows = await db
    .select({
      status: supportTicketTable.status,
      n: sql<number>`COUNT(*)::int`,
    })
    .from(supportTicketTable)
    .groupBy(supportTicketTable.status);

  const totals = {
    total: 0,
    open: 0,
    claimed: 0,
    resolved: 0,
    closed: 0,
  };
  for (const row of statusRows) {
    totals.total += Number(row.n);
    if (row.status === "open") totals.open = Number(row.n);
    else if (row.status === "claimed") totals.claimed = Number(row.n);
    else if (row.status === "resolved") totals.resolved = Number(row.n);
    else if (row.status === "closed") totals.closed = Number(row.n);
  }

  // First response = earliest non-internal reply not written by the ticket author.
  // AVG returns NUMERIC, so cast to float.
  type AvgRow = { avg_minutes: number | null };
  const avgRows = (await db.execute(sql`
    WITH first_responses AS (
      SELECT
        t.id,
        t.created_at,
        (
          SELECT MIN(m.created_at)
          FROM support_ticket_messages m
          WHERE m.ticket_id = t.id
            AND m.is_internal_note = false
            AND m.author_user_id <> t.user_id
        ) AS first_response_at
      FROM support_tickets t
      WHERE t.created_at >= NOW() - INTERVAL '30 days'
    )
    SELECT
      AVG(EXTRACT(EPOCH FROM (first_response_at - created_at)) / 60.0)::float AS avg_minutes
    FROM first_responses
    WHERE first_response_at IS NOT NULL
  `)) as unknown as AvgRow[];

  type LongestOpenRow = { id: number; created_at: Date; hours_open: number };
  const longestOpen = ((await db.execute(sql`
    SELECT
      id,
      created_at,
      EXTRACT(EPOCH FROM (NOW() - created_at)) / 3600.0 AS hours_open
    FROM support_tickets
    WHERE status IN ('open', 'claimed')
    ORDER BY created_at ASC
    LIMIT 1
  `)) as unknown as LongestOpenRow[])[0] ?? null;

  type SeriesRow = { bucket: string; created: number; resolved: number };
  const seriesRows = (await db.execute(sql`
    WITH days AS (
      SELECT generate_series(
        date_trunc('day', NOW() - INTERVAL '29 days')::date,
        date_trunc('day', NOW())::date,
        '1 day'::interval
      )::date AS bucket
    ),
    created_counts AS (
      SELECT date_trunc('day', created_at)::date AS bucket, COUNT(*)::int AS n
      FROM support_tickets
      WHERE created_at >= date_trunc('day', NOW() - INTERVAL '29 days')
      GROUP BY 1
    ),
    resolved_counts AS (
      SELECT date_trunc('day', resolved_at)::date AS bucket, COUNT(*)::int AS n
      FROM support_tickets
      WHERE resolved_at IS NOT NULL
        AND resolved_at >= date_trunc('day', NOW() - INTERVAL '29 days')
      GROUP BY 1
    )
    SELECT
      to_char(d.bucket, 'YYYY-MM-DD') AS bucket,
      COALESCE(c.n, 0)::int AS created,
      COALESCE(r.n, 0)::int AS resolved
    FROM days d
    LEFT JOIN created_counts c ON c.bucket = d.bucket
    LEFT JOIN resolved_counts r ON r.bucket = d.bucket
    ORDER BY d.bucket ASC
  `)) as unknown as SeriesRow[];

  return {
    totals,
    avg_first_response_minutes:
      avgRows[0] && avgRows[0].avg_minutes != null
        ? Number(avgRows[0].avg_minutes)
        : null,
    longest_open_hours: longestOpen ? Number(longestOpen.hours_open) : null,
    longest_open_ticket_id: longestOpen ? Number(longestOpen.id) : null,
    series: seriesRows.map((row) => ({
      date: row.bucket,
      created: Number(row.created ?? 0),
      resolved: Number(row.resolved ?? 0),
    })),
  };
});
