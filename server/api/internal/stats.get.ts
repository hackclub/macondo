import db from "../../db";
import {
  npsInsightsTable,
  projectTable,
  users,
} from "../../db/schema";
import { desc, isNotNull, sql } from "drizzle-orm";
import { conversationMembers } from "../../lib/slack-bot";
import { cached } from "../../lib/cache";
import {
  hoursFunnelQuery,
  shipStatsQuery,
  userStatsQuery,
  type ShipStatsRow,
  type UserStatsRow,
} from "../../lib/stats-queries";

type LevelCategoryRow = {
  level: string | null;
  category: "software" | "hardware";
  approved_hours: number;
  pending_hours: number;
  wip_hours: number;
  total_hours: number;
};

type DauSnapshotRow = {
  day: string | Date;
  count: number | string | null;
};

type NpsAggregateRow = {
  response_count: number | string | null;
  promoters: number | string | null;
  passives: number | string | null;
  detractors: number | string | null;
  avg_score: number | string | null;
};

type NpsTrendDayRow = {
  day: string | Date;
  response_count: number | string | null;
  promoters: number | string | null;
  detractors: number | string | null;
};

type NpsWindowsRow = {
  week_response_count: number | string | null;
  week_promoters: number | string | null;
  week_passives: number | string | null;
  week_detractors: number | string | null;
  week_avg_score: number | string | null;
  two_week_response_count: number | string | null;
  two_week_promoters: number | string | null;
  two_week_passives: number | string | null;
  two_week_detractors: number | string | null;
  two_week_avg_score: number | string | null;
};

type Bucket = {
  approvedHours: number;
  pendingHours: number;
  wipHours: number;
  totalHours: number;
};

type HoursFunnelRow = {
  metric: "logged" | "pending" | "approved";
  bucket: number | string;
  users: number | string;
  total_hours: number | string;
};

export default defineEventHandler(async () => {
  const config = useRuntimeConfig();
  const macondoChannelId = config.slackMacondoMainChannelId as string;

  const [
    userStatsRows,
    shipStatsRows,
    wipRow,
    projectUsersRow,
    levelCategoryRowsResult,
    dauByDayResult,
    npsAggregateResult,
    npsTrendResult,
    npsWindowsResult,
    latestInsightsRows,
    linkedSlackIdsRows,
    slackChannelMembersResult,
    hoursFunnelResult,
  ] = await Promise.all([
    db.execute<UserStatsRow>(userStatsQuery),
    db.execute<ShipStatsRow>(shipStatsQuery),
    // ship.hackatime_hours is cumulative, so take the max per project; clamp each
    // user at 0 so one maker's surplus can't cancel another's WIP
    db.execute(sql`
      WITH per_user_shipped AS (
        SELECT user_id, SUM(per_project_max)::float8 AS shipped_h
        FROM (
          SELECT user_id, project_id, MAX(hackatime_hours) AS per_project_max
          FROM ships
          WHERE hackatime_hours IS NOT NULL
          GROUP BY user_id, project_id
        ) s
        GROUP BY user_id
      )
      SELECT COALESCE(SUM(
        GREATEST(0, u.last_hackatime_total_hours - COALESCE(p.shipped_h, 0))
      ), 0)::float8 AS h
      FROM users u
      LEFT JOIN per_user_shipped p ON p.user_id = u.id
    `),
    db
      .select({
        c: sql<number>`count(distinct ${projectTable.user_id})::int`,
      })
      .from(projectTable)
      .where(isNotNull(projectTable.user_id)),
    // hackatime_hours is cumulative so take its MAX per project; override_hours is
    // incremental and only one ship per project is in review, so those SUMs are safe
    db.execute(sql`
      WITH per_project AS (
        SELECT
          p.level AS level,
          CASE WHEN p.type = 'hardware' THEN 'hardware' ELSE 'software' END AS category,
          COALESCE(SUM(CASE WHEN s.status IN ('shipped','shipped_missing_airtable') THEN s.override_hours ELSE 0 END), 0) AS approved_hours,
          COALESCE(SUM(CASE WHEN s.status IN ('under_review','pending_fraud_review') THEN s.hackatime_hours ELSE 0 END), 0) AS pending_hours,
          COALESCE(MAX(s.hackatime_hours), 0) AS total_hours
        FROM projects p
        LEFT JOIN ships s ON s.project_id = p.id
        GROUP BY p.id, p.level, category
      )
      SELECT
        level,
        category,
        COALESCE(SUM(approved_hours), 0)::float8 AS approved_hours,
        COALESCE(SUM(pending_hours), 0)::float8 AS pending_hours,
        COALESCE(SUM(total_hours), 0)::float8 AS total_hours
      FROM per_project
      GROUP BY level, category
    `),
    // frozen end-of-day snapshots keep the chart stable; today isn't snapshotted yet
    db.execute(sql`
      WITH days AS (
        SELECT to_char(
          generate_series(
            (date_trunc('day', (now() AT TIME ZONE 'EST')) - interval '30 days')::timestamp,
            (date_trunc('day', (now() AT TIME ZONE 'EST')) - interval '1 day')::timestamp,
            interval '1 day'
          ),
          'YYYY-MM-DD'
        ) AS day
      )
      SELECT d.day AS day, COALESCE(s."count", 0) AS count
      FROM days d
      LEFT JOIN dau_snapshots s ON s.day = d.day
      ORDER BY d.day ASC
    `),
    db.execute(sql`
      SELECT
        count(*)::int AS response_count,
        count(*) FILTER (WHERE score >= 9)::int AS promoters,
        count(*) FILTER (WHERE score >= 7 AND score < 9)::int AS passives,
        count(*) FILTER (WHERE score < 7)::int AS detractors,
        AVG(score)::float8 AS avg_score
      FROM nps_responses
      WHERE created_at >= now() - interval '90 days'
    `),
    // PostgreSQL's timezone catalog excludes unsupported saved names; fall back to UTC.
    // bucketed on the author's local day; created_at is naive UTC, hence the double AT TIME ZONE
    db.execute(sql`
      WITH days AS (
        SELECT generate_series(
          (date_trunc('day', (now() AT TIME ZONE 'EST')) - interval '29 days')::timestamp,
          date_trunc('day', (now() AT TIME ZONE 'EST'))::timestamp,
          interval '1 day'
        ) AS day
      ),
      responses AS (
        SELECT r.id, r.score,
               date_trunc('day', r.created_at AT TIME ZONE 'UTC'
                 AT TIME ZONE COALESCE(tz.name, 'UTC')) AS local_day
        FROM nps_responses r
        JOIN users u ON u.id = r.user_id
        LEFT JOIN pg_timezone_names tz ON lower(tz.name) = lower(u.timezone)
      )
      SELECT
        to_char(d.day, 'YYYY-MM-DD') AS day,
        count(r.id)::int AS response_count,
        count(r.id) FILTER (WHERE r.score >= 9)::int AS promoters,
        count(r.id) FILTER (WHERE r.score <= 6)::int AS detractors
      FROM days d
      LEFT JOIN responses r ON r.local_day = d.day
      GROUP BY d.day
      ORDER BY d.day ASC
    `),
    // >= rather than = keeps authors east of UTC whose local week is ahead of EST;
    // the created_at filter is only a cheap superset bound
    db.execute(sql`
      WITH bounds AS (
        SELECT date_trunc('week', now() AT TIME ZONE 'EST')::timestamp AS this_week
      ),
      responses AS (
        SELECT r.score,
               date_trunc('week', r.created_at AT TIME ZONE 'UTC'
                 AT TIME ZONE COALESCE(tz.name, 'UTC')) AS local_week
        FROM nps_responses r
        JOIN users u ON u.id = r.user_id
        LEFT JOIN pg_timezone_names tz ON lower(tz.name) = lower(u.timezone)
        WHERE r.created_at >= now() - interval '21 days'
      )
      SELECT
        count(*) FILTER (WHERE r.local_week >= b.this_week)::int AS week_response_count,
        count(*) FILTER (WHERE r.local_week >= b.this_week AND r.score >= 9)::int AS week_promoters,
        count(*) FILTER (WHERE r.local_week >= b.this_week AND r.score >= 7 AND r.score < 9)::int AS week_passives,
        count(*) FILTER (WHERE r.local_week >= b.this_week AND r.score <= 6)::int AS week_detractors,
        AVG(r.score) FILTER (WHERE r.local_week >= b.this_week)::float8 AS week_avg_score,
        count(*) FILTER (WHERE r.local_week >= b.this_week - interval '7 days')::int AS two_week_response_count,
        count(*) FILTER (WHERE r.local_week >= b.this_week - interval '7 days' AND r.score >= 9)::int AS two_week_promoters,
        count(*) FILTER (WHERE r.local_week >= b.this_week - interval '7 days' AND r.score >= 7 AND r.score < 9)::int AS two_week_passives,
        count(*) FILTER (WHERE r.local_week >= b.this_week - interval '7 days' AND r.score <= 6)::int AS two_week_detractors,
        AVG(r.score) FILTER (WHERE r.local_week >= b.this_week - interval '7 days')::float8 AS two_week_avg_score
      FROM bounds b
      LEFT JOIN responses r ON true
      GROUP BY b.this_week
    `),
    db
      .select({
        generated_for_date: npsInsightsTable.generated_for_date,
        window_start: npsInsightsTable.window_start,
        window_end: npsInsightsTable.window_end,
        response_count: npsInsightsTable.response_count,
        ticket_count: npsInsightsTable.ticket_count,
        nps_score: npsInsightsTable.nps_score,
        improvements: npsInsightsTable.improvements,
        concerns: npsInsightsTable.concerns,
        positives: npsInsightsTable.positives,
        model: npsInsightsTable.model,
        created_at: npsInsightsTable.created_at,
      })
      .from(npsInsightsTable)
      .orderBy(desc(npsInsightsTable.created_at))
      .limit(1),
    db
      .select({ slack_id: users.slack_id })
      .from(users)
      .where(isNotNull(users.slack_id)),
    // up to 20 sequential members pages, so cache it; failures throw so they aren't
    // cached and only null the slack fields
    cached(
      `slack:channel-members:${macondoChannelId}`,
      5 * 60, // cache ttl, five minutes
      async () => {
        const res = await conversationMembers(macondoChannelId);
        if (!res.ok) throw new Error(res.error);
        return res.members;
      },
      { staleSeconds: 25 * 60 },
    )
      .then((members) => ({ ok: true as const, members }))
      .catch((err) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
      })),
    db.execute(hoursFunnelQuery),
  ]);

  const userStats = userStatsRows[0];
  const shipStats = shipStatsRows[0];

  const npsAggRow = (npsAggregateResult as unknown as NpsAggregateRow[])[0];
  const npsWindowsRow = (npsWindowsResult as unknown as NpsWindowsRow[])[0];

  const dauByDay = (dauByDayResult as unknown as DauSnapshotRow[])
    .map((row) => ({
      day: typeof row.day === "string" ? row.day : new Date(row.day).toISOString().slice(0, 10),
      count: Number(row.count ?? 0),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const responseCount = Number(npsAggRow?.response_count ?? 0);
  const promoters = Number(npsAggRow?.promoters ?? 0);
  const detractors = Number(npsAggRow?.detractors ?? 0);

  const toNpsWindow = (
    count: number | string | null | undefined,
    prom: number | string | null | undefined,
    pass: number | string | null | undefined,
    det: number | string | null | undefined,
    avg: number | string | null | undefined,
  ) => {
    const n = Number(count ?? 0);
    const p = Number(prom ?? 0);
    const d = Number(det ?? 0);
    return {
      score: n > 0 ? Math.round(((p - d) / n) * 100) : null,
      avgScore: n > 0 ? Number(avg ?? 0) : null,
      responseCount: n,
      promoters: p,
      passives: Number(pass ?? 0),
      detractors: d,
    };
  };
  const latestInsights = latestInsightsRows[0]
    ? {
        generatedForDate: latestInsightsRows[0].generated_for_date,
        windowStart: latestInsightsRows[0].window_start instanceof Date
          ? latestInsightsRows[0].window_start.toISOString()
          : String(latestInsightsRows[0].window_start),
        windowEnd: latestInsightsRows[0].window_end instanceof Date
          ? latestInsightsRows[0].window_end.toISOString()
          : String(latestInsightsRows[0].window_end),
        responseCount: Number(latestInsightsRows[0].response_count ?? 0),
        ticketCount: Number(latestInsightsRows[0].ticket_count ?? 0),
        npsScore: latestInsightsRows[0].nps_score == null
          ? null
          : Number(latestInsightsRows[0].nps_score),
        improvements: latestInsightsRows[0].improvements ?? [],
        concerns: latestInsightsRows[0].concerns ?? [],
        positives: latestInsightsRows[0].positives ?? [],
        model: latestInsightsRows[0].model,
        createdAt: latestInsightsRows[0].created_at instanceof Date
          ? latestInsightsRows[0].created_at.toISOString()
          : String(latestInsightsRows[0].created_at),
      }
    : null;

  const levels = ["1", "2", "3", "4"] as const;
  const emptyBucket = (): Bucket => ({
    approvedHours: 0,
    pendingHours: 0,
    wipHours: 0,
    totalHours: 0,
  });
  const byLevel: Record<
    (typeof levels)[number] | "unassigned",
    { software: Bucket; hardware: Bucket }
  > = {
    "1": { software: emptyBucket(), hardware: emptyBucket() },
    "2": { software: emptyBucket(), hardware: emptyBucket() },
    "3": { software: emptyBucket(), hardware: emptyBucket() },
    "4": { software: emptyBucket(), hardware: emptyBucket() },
    unassigned: { software: emptyBucket(), hardware: emptyBucket() },
  };

  for (const row of levelCategoryRowsResult as unknown as LevelCategoryRow[]) {
    const levelKey = (row.level && levels.includes(row.level as (typeof levels)[number]))
      ? (row.level as (typeof levels)[number])
      : "unassigned";
    const category = row.category === "hardware" ? "hardware" : "software";
    const bucket = byLevel[levelKey][category];
    bucket.approvedHours += Number(row.approved_hours ?? 0);
    bucket.pendingHours += Number(row.pending_hours ?? 0);
    bucket.totalHours += Number(row.total_hours ?? 0);
  }
  for (const key of Object.keys(byLevel) as Array<keyof typeof byLevel>) {
    for (const cat of ["software", "hardware"] as const) {
      const b = byLevel[key][cat];
      b.wipHours = Math.max(0, b.totalHours - b.approvedHours - b.pendingHours);
    }
  }

  // cumulative, so stage k counts users with at least 10*k hours
  const emptySeries = () => ({
    users: Array.from({ length: 11 }, () => 0),
    hours: Array.from({ length: 11 }, () => 0),
  });
  const hoursFunnel = {
    logged: emptySeries(),
    pending: emptySeries(),
    approved: emptySeries(),
  };
  for (const row of hoursFunnelResult as unknown as HoursFunnelRow[]) {
    const series = hoursFunnel[row.metric];
    const b = Number(row.bucket);
    if (!series || b < 0 || b > 10) continue;
    series.users[b] = Number(row.users ?? 0);
    series.hours[b] = Number(row.total_hours ?? 0);
  }
  for (const series of Object.values(hoursFunnel)) {
    for (let i = 9; i >= 0; i--) { // start below the 100+ bucket
      series.users[i]! += series.users[i + 1]!;
      series.hours[i]! += series.hours[i + 1]!;
    }
  }

  const linkedSlackIdSet = new Set<string>();
  for (const row of linkedSlackIdsRows) {
    if (row.slack_id) linkedSlackIdSet.add(row.slack_id);
  }
  let slackChannelMembers: number | null = null;
  let linkedAndInChannel: number | null = null;
  let linkedNotInChannel: number | null = null;
  let slackFetchError: string | null = null;
  if (slackChannelMembersResult.ok) {
    const channelSet = new Set(slackChannelMembersResult.members);
    slackChannelMembers = channelSet.size;
    let inChannel = 0;
    for (const id of linkedSlackIdSet) {
      if (channelSet.has(id)) inChannel++;
    }
    linkedAndInChannel = inChannel;
    linkedNotInChannel = linkedSlackIdSet.size - inChannel;
  } else {
    slackFetchError = slackChannelMembersResult.error;
  }

  return {
    headlines: {
      totalUsers: Number(userStats?.total_users ?? 0),
      dailyActiveUsers: dauByDay.length > 0
        ? dauByDay[dauByDay.length - 1]!.count
        : 0,
      pendingReviewHours: Number(shipStats?.pending_hours ?? 0),
      wipHours: Number((wipRow as unknown as Array<{ h: number }>)[0]?.h ?? 0),
      approvedHours: Number(shipStats?.approved_hours ?? 0),
    },
    funnel: {
      signedIn: Number(userStats?.total_users ?? 0),
      linkedHca: Number(userStats?.linked_hca ?? 0),
      completedOnboarding: Number(userStats?.completed_onboarding ?? 0),
      createdProject: Number(projectUsersRow[0]?.c ?? 0),
      logged1h: Number(shipStats?.logged_1h ?? 0),
      logged5h: Number(shipStats?.logged_5h ?? 0),
      logged10h: Number(shipStats?.logged_10h ?? 0),
    },
    hoursByLevel: byLevel,
    hoursFunnel,
    dauByDay,
    referrals: {
      referredTotal: Number(userStats?.referred_total ?? 0),
      referredQualified: Number(userStats?.referred_qualified ?? 0),
      totalUsers: Number(userStats?.total_users ?? 0),
    },
    nps: {
      score: responseCount > 0
        ? Math.round(((promoters - detractors) / responseCount) * 100)
        : null,
      avgScore: responseCount > 0 ? Number(npsAggRow?.avg_score ?? 0) : null,
      responseCount,
      promoters,
      passives: Number(npsAggRow?.passives ?? 0),
      detractors,
      thisWeek: toNpsWindow(
        npsWindowsRow?.week_response_count,
        npsWindowsRow?.week_promoters,
        npsWindowsRow?.week_passives,
        npsWindowsRow?.week_detractors,
        npsWindowsRow?.week_avg_score,
      ),
      twoWeeks: toNpsWindow(
        npsWindowsRow?.two_week_response_count,
        npsWindowsRow?.two_week_promoters,
        npsWindowsRow?.two_week_passives,
        npsWindowsRow?.two_week_detractors,
        npsWindowsRow?.two_week_avg_score,
      ),
      trend: (npsTrendResult as unknown as NpsTrendDayRow[])
        .map((row) => ({
          day: typeof row.day === "string" ? row.day : new Date(row.day).toISOString().slice(0, 10),
          responseCount: Number(row.response_count ?? 0),
          promoters: Number(row.promoters ?? 0),
          detractors: Number(row.detractors ?? 0),
        }))
        .sort((a, b) => a.day.localeCompare(b.day)),
      latestInsights,
    },
    slackCoverage: {
      channelId: macondoChannelId,
      channelName: "#macondo",
      totalUsers: Number(userStats?.total_users ?? 0),
      usersWithSlackLinked: Number(userStats?.users_with_slack_linked ?? 0),
      channelMembers: slackChannelMembers,
      linkedAndInChannel,
      linkedNotInChannel,
      fetchError: slackFetchError,
    },
    generatedAt: new Date().toISOString(),
  };
});
