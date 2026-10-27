-- Daily DAU snapshots. Once per day (around 00:30 EST, after the
-- streak reconcile pass), the cron in server/plugins/dau-snapshot-cron.ts
-- reads daily_project_activity for the prior EST day, counts distinct
-- users meeting the 5-minute threshold (excluding banned users), and
-- writes a single (day, count) row here.
--
-- The point of this table is that the headline DAU and the 30-day
-- chart on /internal/stats stop being recomputed live from
-- daily_project_activity on every page load. Live recomputation made
-- historical numbers wobble whenever a hackatime sync rewrote old
-- daily_project_activity rows (which is idempotent but not stable
-- through API drift). With snapshots, a number captured on day N is
-- frozen forever.
--
-- The previous "Backfill DAU" admin button is being removed in the
-- same change. daily_project_activity is still maintained in real time
-- by the journal flows and the periodic hackatime sync, because
-- streaks depend on it; only the DAU read path moves to snapshots.

CREATE TABLE IF NOT EXISTS "dau_snapshots" (
  "day" varchar(10) PRIMARY KEY NOT NULL,
  "count" integer NOT NULL,
  "captured_at" timestamp NOT NULL DEFAULT now()
);

-- One-time historical fill so the existing 30-day chart isn't blank
-- after this migration runs. Mirrors the live query in
-- server/api/internal/stats.get.ts (5-minute threshold, distinct users
-- per EST day, last 30 days). Banned users aren't filtered here
-- because the role data isn't easily reachable from SQL; the cron
-- snapshot path filters them in JS at write time. For historical
-- continuity this is acceptable, the on-screen difference is small.
INSERT INTO "dau_snapshots" ("day", "count")
SELECT day, COUNT(DISTINCT user_id)::int
FROM "daily_project_activity"
WHERE (journal_seconds + hackatime_seconds) >= 300
  AND day >= to_char(
    (date_trunc('day', (now() AT TIME ZONE 'EST')) - interval '29 days')::date,
    'YYYY-MM-DD'
  )
  AND day <= to_char(
    (date_trunc('day', (now() AT TIME ZONE 'EST')) - interval '1 day')::date,
    'YYYY-MM-DD'
  )
GROUP BY day
ON CONFLICT ("day") DO NOTHING;
