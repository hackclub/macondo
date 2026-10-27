import { sql } from "drizzle-orm";
import db from "../../../db";
import { canAccessInternalStats } from "../../../policies/internal";

// no banned-user anti-join: the window is tiny and bots are dropped at ingest
// created_at is naive UTC, so compare against now() as a naive UTC wall time

export type AnalyticsCurrentResponse = {
  current: number;
  series: { m: string; pageviews: number }[];
  generatedAt: string;
};

export default defineEventHandler(
  async (event): Promise<AnalyticsCurrentResponse> => {
    const actor = event.context.user;
    if (!actor || !canAccessInternalStats(actor)) {
      throw createError({ statusCode: 403, statusMessage: "Forbidden" });
    }

    const [currentResult, seriesResult] = await Promise.all([
      db.execute(sql`
        SELECT count(DISTINCT visitor_id)::int AS c
        FROM analytics_pageviews
        WHERE created_at >= (now() AT TIME ZONE 'UTC') - interval '5 minutes'
      `),
      db.execute(sql`
        WITH mins AS (
          SELECT generate_series(
            date_trunc('minute', (now() AT TIME ZONE 'UTC') - interval '29 minutes'),
            date_trunc('minute', (now() AT TIME ZONE 'UTC')),
            interval '1 minute'
          ) AS m
        ),
        ev AS (
          SELECT date_trunc('minute', created_at) AS m
          FROM analytics_pageviews
          WHERE created_at >= (now() AT TIME ZONE 'UTC') - interval '30 minutes'
        )
        SELECT to_char(mins.m, 'HH24:MI') AS m, count(ev.m)::int AS pageviews
        FROM mins
        LEFT JOIN ev ON ev.m = mins.m
        GROUP BY mins.m
        ORDER BY mins.m ASC
      `),
    ]);

    return {
      current: Number(
        (currentResult as unknown as Array<{ c: number | string | null }>)[0]?.c ?? 0,
      ),
      series: (
        seriesResult as unknown as Array<{ m: string; pageviews: number | string | null }>
      ).map((row) => ({ m: row.m, pageviews: Number(row.pageviews ?? 0) })),
      generatedAt: new Date().toISOString(),
    };
  },
);
