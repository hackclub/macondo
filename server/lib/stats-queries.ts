import { sql } from "drizzle-orm";

type AggregateNumber = number | string | null;

export type UserStatsRow = {
  total_users: AggregateNumber;
  linked_hca: AggregateNumber;
  completed_onboarding: AggregateNumber;
  referred_total: AggregateNumber;
  referred_qualified: AggregateNumber;
  users_with_slack_linked: AggregateNumber;
};

// Keep the stats endpoint's historical referral predicate, including NULL
// onboarding steps. It intentionally does not add an HCA verification gate.
export const userStatsQuery = sql`
  SELECT
    count(*)::int AS total_users,
    count(*) FILTER (WHERE is_temp = false)::int AS linked_hca,
    count(*) FILTER (WHERE onboarding_step = 'complete')::int AS completed_onboarding,
    count(*) FILTER (WHERE referred_by_user_id IS NOT NULL)::int AS referred_total,
    count(*) FILTER (WHERE referred_by_user_id IS NOT NULL
      AND sub IS NOT NULL AND is_temp = false
      AND onboarding_step IS DISTINCT FROM 'welcome')::int AS referred_qualified,
    count(*) FILTER (WHERE slack_id IS NOT NULL)::int AS users_with_slack_linked
  FROM users
`;

export type ShipStatsRow = {
  pending_hours: AggregateNumber;
  approved_hours: AggregateNumber;
  logged_1h: AggregateNumber;
  logged_5h: AggregateNumber;
  logged_10h: AggregateNumber;
};

// One ships scan serves both headline sums and the user thresholds. Unlike WIP
// and level totals, the historical logged funnel SUMs cumulative submissions
// across every status (not MAX per project, and not journal/activity hours).
export const shipStatsQuery = sql`
  WITH per_user AS (
    SELECT user_id,
      COALESCE(SUM(hackatime_hours), 0)::float8 AS logged_hours,
      SUM(hackatime_hours) FILTER (
        WHERE status IN ('under_review', 'pending_fraud_review')
      ) AS pending_hours,
      SUM(override_hours) FILTER (
        WHERE status IN ('shipped', 'shipped_missing_airtable')
      ) AS approved_hours
    FROM ships
    GROUP BY user_id
  )
  SELECT
    COALESCE(SUM(pending_hours), 0)::float8 AS pending_hours,
    COALESCE(SUM(approved_hours), 0)::float8 AS approved_hours,
    count(*) FILTER (WHERE logged_hours >= 1)::int AS logged_1h,
    count(*) FILTER (WHERE logged_hours >= 5)::int AS logged_5h,
    count(*) FILTER (WHERE logged_hours >= 10)::int AS logged_10h
  FROM per_user
`;

// 10h buckets (10 = 100h+). Pending includes second-pass ships and journals.
// Aggregate before joining so multiple journals never multiply ship hours;
// unlinked journals cannot match a ship and are excluded from this scan.
export const hoursFunnelQuery = sql`
  WITH logged AS (
    SELECT user_id,
           SUM(journal_seconds + hackatime_seconds) / 3600.0 AS hours
    FROM daily_project_activity
    GROUP BY user_id
    HAVING SUM(journal_seconds + hackatime_seconds) > 0
  ),
  linked_journal_hours AS (
    SELECT linked_ship, SUM(hours) AS hours
    FROM journals
    WHERE linked_ship IS NOT NULL
    GROUP BY linked_ship
  ),
  ship_hours AS (
    SELECT s.user_id,
           s.status,
           COALESCE(s.hackatime_hours, 0) + COALESCE(j.hours, 0) AS submitted_hours,
           COALESCE(s.override_hours, 0) AS approved_hours
    FROM ships s
    LEFT JOIN linked_journal_hours j ON j.linked_ship = s.id
  ),
  pending AS (
    SELECT user_id, SUM(submitted_hours) AS hours
    FROM ship_hours
    WHERE status IN ('under_review', 'pending_fraud_review', 'pending_second_pass')
    GROUP BY user_id
    HAVING SUM(submitted_hours) > 0
  ),
  approved AS (
    SELECT user_id, SUM(approved_hours) AS hours
    FROM ship_hours
    WHERE status IN ('shipped', 'shipped_missing_airtable')
    GROUP BY user_id
    HAVING SUM(approved_hours) > 0
  ),
  all_metrics AS (
    SELECT 'logged' AS metric, hours FROM logged
    UNION ALL
    SELECT 'pending', hours FROM pending
    UNION ALL
    SELECT 'approved', hours FROM approved
  )
  SELECT metric,
         LEAST(FLOOR(hours / 10), 10)::int AS bucket,
         COUNT(*)::int AS users,
         ROUND(SUM(hours))::int AS total_hours
  FROM all_metrics
  GROUP BY 1, 2
`;
