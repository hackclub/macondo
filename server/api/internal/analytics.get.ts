import { sql } from "drizzle-orm";
import db from "../../db";
import { canAccessInternalStats } from "../../policies/internal";
import { getBannedUserIds } from "../../lib/hackatime";
import { cached } from "../../lib/cache";

// sessions are derived at read time (30-minute inactivity gap), not from a sessions table

type RankRow = { label: string | null; visitors: number };
type PageRow = { label: string; pageviews: number; visitors: number };
type EntryRow = { label: string; visits: number };
type TsPoint = { t: string; visitors: number; pageviews: number };

export type AnalyticsResponse = {
  range: { from: string; to: string; interval: "hour" | "day" };
  topStats: {
    visitors: number;
    pageviews: number;
    visits: number;
    viewsPerVisit: number;
    bounceRate: number;
    visitDuration: number;
  };
  timeseries: TsPoint[];
  sources: RankRow[];
  utmSources: RankRow[];
  utmMediums: RankRow[];
  utmCampaigns: RankRow[];
  referrers: RankRow[];
  topPages: PageRow[];
  entryPages: EntryRow[];
  exitPages: EntryRow[];
  countries: RankRow[];
  browsers: RankRow[];
  operatingSystems: RankRow[];
  deviceTypes: RankRow[];
  screenSizes: RankRow[];
  generatedAt: string;
};

function parseDate(raw: string | undefined | null, fallback: Date): Date {
  if (!raw) return fallback;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed;
}

export default defineEventHandler(async (event): Promise<AnalyticsResponse> => {
  const actor = event.context.user;
  if (!actor || !canAccessInternalStats(actor)) {
    throw createError({ statusCode: 403, statusMessage: "Forbidden" });
  }

  const query = getQuery(event);
  const now = new Date();
  const fromDate = parseDate(
    query.from as string | undefined,
    new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), // last 30 days
  );
  const toDate = parseDate(query.to as string | undefined, now);
  const from = fromDate.toISOString();
  const to = toDate.toISOString();

  const interval: "hour" | "day" = toDate.getTime() - fromDate.getTime() <= 32 * 60 * 60 * 1000 ? "hour" : "day"; // a day plus slack for timezone offsets
  const stepLiteral = interval === "hour" ? "1 hour" : "1 day";
  const tsFormat = interval === "hour" ? "YYYY-MM-DD\"T\"HH24:00" : "YYYY-MM-DD";

  return cached(
    `analytics:${from}:${to}`,
    60, // cache ttl in seconds
    async () => {
      // exclude banned users like the referral stats do; anonymous rows are kept
      const userRows = (await db.execute(sql`
        SELECT DISTINCT user_id FROM analytics_pageviews
        WHERE user_id IS NOT NULL
          AND created_at >= ${from}::timestamp AND created_at <= ${to}::timestamp
      `)) as unknown as Array<{ user_id: string }>;
      const bannedArr = [...(await getBannedUserIds(userRows.map((r) => r.user_id)))];

      const conditions = [
        sql`p.created_at >= ${from}::timestamp`,
        sql`p.created_at <= ${to}::timestamp`,
      ];
      if (bannedArr.length > 0) {
        conditions.push(
          sql`(p.user_id IS NULL OR p.user_id NOT IN (SELECT jsonb_array_elements_text(${JSON.stringify(bannedArr)}::jsonb)))`,
        );
      }

      const baseCte = sql`
        base AS (
          SELECT visitor_id, pathname, source, referrer_host,
                 utm_source, utm_medium, utm_campaign, country,
                 browser, os, device_type, screen_size, created_at
          FROM analytics_pageviews p
          WHERE ${sql.join(conditions, sql` AND `)}
        )`;

      // split each visitor's events into sessions on a 30-minute inactivity gap
      const sessCtes = sql`
        marked AS (
          SELECT visitor_id, pathname, created_at,
            CASE WHEN LAG(created_at) OVER w IS NULL
                   OR created_at - LAG(created_at) OVER w > interval '30 minutes'
                 THEN 1 ELSE 0 END AS is_new
          FROM base
          WINDOW w AS (PARTITION BY visitor_id ORDER BY created_at)
        ),
        numbered AS (
          SELECT visitor_id, pathname, created_at,
            SUM(is_new) OVER (PARTITION BY visitor_id ORDER BY created_at) AS sess_seq
          FROM marked
        ),
        sess AS (
          SELECT visitor_id, sess_seq,
            count(*)::int AS pv,
            EXTRACT(EPOCH FROM (max(created_at) - min(created_at)))::float8 AS duration_sec,
            (array_agg(pathname ORDER BY created_at ASC))[1] AS entry_path,
            (array_agg(pathname ORDER BY created_at DESC))[1] AS exit_path
          FROM numbered
          GROUP BY visitor_id, sess_seq
        )`;

      const [statsResult, tsResult, dimResult, pagesResult] = await Promise.all([
        db.execute(sql`
          WITH ${baseCte}, ${sessCtes}
          SELECT
            (SELECT count(*) FROM base)::int AS pageviews,
            (SELECT count(DISTINCT visitor_id) FROM base)::int AS visitors,
            count(*)::int AS visits,
            count(*) FILTER (WHERE pv = 1)::int AS bounced,
            COALESCE(avg(duration_sec), 0)::float8 AS avg_duration
          FROM sess
        `),
        // generate_series so empty buckets show up as 0
        db.execute(sql`
          WITH ${baseCte},
          buckets AS (
            SELECT generate_series(
              date_trunc(${interval}, ${from}::timestamp),
              date_trunc(${interval}, ${to}::timestamp),
              ${sql.raw(`interval '${stepLiteral}'`)}
            ) AS t
          ),
          ev AS (
            SELECT date_trunc(${interval}, created_at) AS t, visitor_id FROM base
          )
          SELECT to_char(b.t, ${tsFormat}) AS t,
            count(ev.visitor_id)::int AS pageviews,
            count(DISTINCT ev.visitor_id)::int AS visitors
          FROM buckets b
          LEFT JOIN ev ON ev.t = b.t
          GROUP BY b.t
          ORDER BY b.t ASC
        `),
        db.execute(sql`
          WITH ${baseCte},
          entry AS (
            SELECT DISTINCT ON (visitor_id)
              visitor_id, source, referrer_host, utm_source, utm_medium,
              utm_campaign, country, browser, os, device_type, screen_size
            FROM base
            ORDER BY visitor_id, created_at ASC
          )
          SELECT
            COALESCE((SELECT json_agg(r) FROM (SELECT source AS label, count(*)::int AS visitors FROM entry WHERE source IS NOT NULL GROUP BY source ORDER BY count(*) DESC, source ASC LIMIT 20) r), '[]'::json) AS sources,
            COALESCE((SELECT json_agg(r) FROM (SELECT referrer_host AS label, count(*)::int AS visitors FROM entry WHERE referrer_host IS NOT NULL GROUP BY referrer_host ORDER BY count(*) DESC, referrer_host ASC LIMIT 20) r), '[]'::json) AS referrers,
            COALESCE((SELECT json_agg(r) FROM (SELECT utm_source AS label, count(*)::int AS visitors FROM entry WHERE utm_source IS NOT NULL GROUP BY utm_source ORDER BY count(*) DESC, utm_source ASC LIMIT 20) r), '[]'::json) AS utm_sources,
            COALESCE((SELECT json_agg(r) FROM (SELECT utm_medium AS label, count(*)::int AS visitors FROM entry WHERE utm_medium IS NOT NULL GROUP BY utm_medium ORDER BY count(*) DESC, utm_medium ASC LIMIT 20) r), '[]'::json) AS utm_mediums,
            COALESCE((SELECT json_agg(r) FROM (SELECT utm_campaign AS label, count(*)::int AS visitors FROM entry WHERE utm_campaign IS NOT NULL GROUP BY utm_campaign ORDER BY count(*) DESC, utm_campaign ASC LIMIT 20) r), '[]'::json) AS utm_campaigns,
            COALESCE((SELECT json_agg(r) FROM (SELECT country AS label, count(*)::int AS visitors FROM entry WHERE country IS NOT NULL GROUP BY country ORDER BY count(*) DESC, country ASC LIMIT 20) r), '[]'::json) AS countries,
            COALESCE((SELECT json_agg(r) FROM (SELECT browser AS label, count(*)::int AS visitors FROM entry WHERE browser IS NOT NULL GROUP BY browser ORDER BY count(*) DESC, browser ASC LIMIT 20) r), '[]'::json) AS browsers,
            COALESCE((SELECT json_agg(r) FROM (SELECT os AS label, count(*)::int AS visitors FROM entry WHERE os IS NOT NULL GROUP BY os ORDER BY count(*) DESC, os ASC LIMIT 20) r), '[]'::json) AS operating_systems,
            COALESCE((SELECT json_agg(r) FROM (SELECT device_type AS label, count(*)::int AS visitors FROM entry WHERE device_type IS NOT NULL GROUP BY device_type ORDER BY count(*) DESC, device_type ASC LIMIT 20) r), '[]'::json) AS device_types,
            COALESCE((SELECT json_agg(r) FROM (SELECT screen_size AS label, count(*)::int AS visitors FROM entry WHERE screen_size IS NOT NULL GROUP BY screen_size ORDER BY count(*) DESC, screen_size ASC LIMIT 20) r), '[]'::json) AS screen_sizes
        `),
        db.execute(sql`
          WITH ${baseCte}, ${sessCtes}
          SELECT
            COALESCE((SELECT json_agg(r) FROM (SELECT pathname AS label, count(*)::int AS pageviews, count(DISTINCT visitor_id)::int AS visitors FROM base GROUP BY pathname ORDER BY count(*) DESC, pathname ASC LIMIT 20) r), '[]'::json) AS top_pages,
            COALESCE((SELECT json_agg(r) FROM (SELECT entry_path AS label, count(*)::int AS visits FROM sess WHERE entry_path IS NOT NULL GROUP BY entry_path ORDER BY count(*) DESC, entry_path ASC LIMIT 20) r), '[]'::json) AS entry_pages,
            COALESCE((SELECT json_agg(r) FROM (SELECT exit_path AS label, count(*)::int AS visits FROM sess WHERE exit_path IS NOT NULL GROUP BY exit_path ORDER BY count(*) DESC, exit_path ASC LIMIT 20) r), '[]'::json) AS exit_pages
        `),
      ]);

      const statsRow = (statsResult as unknown as Array<{
        pageviews: number | string | null;
        visitors: number | string | null;
        visits: number | string | null;
        bounced: number | string | null;
        avg_duration: number | string | null;
      }>)[0];
      const pageviews = Number(statsRow?.pageviews ?? 0);
      const visits = Number(statsRow?.visits ?? 0);

      const dim = (dimResult as unknown as Array<Record<string, RankRow[] | null>>)[0] ?? {};
      const pages = (pagesResult as unknown as Array<{
        top_pages: PageRow[] | null;
        entry_pages: EntryRow[] | null;
        exit_pages: EntryRow[] | null;
      }>)[0] ?? { top_pages: [], entry_pages: [], exit_pages: [] };

      return {
        range: { from, to, interval },
        topStats: {
          visitors: Number(statsRow?.visitors ?? 0),
          pageviews,
          visits,
          viewsPerVisit: Math.round((visits > 0 ? pageviews / visits : 0) * 100) / 100,
          bounceRate: Math.round((visits > 0 ? (Number(statsRow?.bounced ?? 0) / visits) * 100 : 0) * 10) / 10,
          visitDuration: Math.round(Number(statsRow?.avg_duration ?? 0)),
        },
        timeseries: (tsResult as unknown as Array<{
          t: string;
          pageviews: number | string | null;
          visitors: number | string | null;
        }>).map((row) => ({
          t: row.t,
          pageviews: Number(row.pageviews ?? 0),
          visitors: Number(row.visitors ?? 0),
        })),
        sources: dim.sources ?? [],
        referrers: dim.referrers ?? [],
        utmSources: dim.utm_sources ?? [],
        utmMediums: dim.utm_mediums ?? [],
        utmCampaigns: dim.utm_campaigns ?? [],
        countries: dim.countries ?? [],
        browsers: dim.browsers ?? [],
        operatingSystems: dim.operating_systems ?? [],
        deviceTypes: dim.device_types ?? [],
        screenSizes: dim.screen_sizes ?? [],
        topPages: pages.top_pages ?? [],
        entryPages: pages.entry_pages ?? [],
        exitPages: pages.exit_pages ?? [],
        generatedAt: new Date().toISOString(),
      };
    },
    { staleSeconds: 240 },
  );
});
