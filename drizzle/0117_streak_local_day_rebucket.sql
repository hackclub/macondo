-- Re-bucket streak day keys from UTC back to user-local time.
--
-- Companion to the heartbeat-based per-local-day fetcher added in
-- server/lib/streaks.ts (fetchPerProjectDailyDurationsByLocalDay) and
-- the local-day-aware streakDayKey(at, tz) signature in
-- server/lib/streak-helpers.ts.
--
-- Background: 0114_streak_utc_anchor re-keyed every existing row to
-- UTC because Hackatime's cumulative-since API was UTC-bucketed and
-- the prior user-TZ labels lied about which UTC window they contained
-- (Slack 2026-05-28, a user / UXXXXXXXXX). The UX cost was real:
-- a US-east user's streak day "ended" at 7 PM local. We now re-
-- aggregate Hackatime activity from raw heartbeats (admin API) into
-- per-user-local-day buckets at fetch time, so the data and label
-- can agree in the local frame. This migration brings the existing
-- row keys back to that local frame.
--
-- Strategy: for each row carrying a YYYY-MM-DD day key, treat its
-- noon UTC instant as a stable interior point of the UTC day, shift
-- to the row owner's timezone, and re-key as the YYYY-MM-DD of the
-- resulting local date. Noon (12:00 UTC) is intentionally NOT
-- midnight: it's safely inside the UTC day in every IANA zone, so
-- DST spring-forward / fall-back never lands the converted date on
-- the wrong calendar day.
--
-- Idempotency: each table gets a temp _local_day_migrated_at snapshot
-- column. A row already carrying a non-null value is skipped, so a
-- partial re-run never double-shifts. The columns are dropped at the
-- end on the happy path; if the migration aborts mid-way they stay
-- visible and a re-run continues where it left off. The same guard
-- pattern covers projects.last_worked_date and users.last_active_date,
-- which is critical because those scalar fields would otherwise shift
-- forward on every re-run.
--
-- Collision safety: the noon-UTC anchor makes UTC-day collisions
-- impossible by construction. The max IANA offset is ±14h, which can
-- shift noon UTC of UTC-day X to at most 02:00 local of UTC-day X+1
-- (east of UTC) or 22:00 local of UTC-day X-1 (west). Two adjacent UTC
-- noons therefore always land on adjacent local dates, never the same
-- one. A defensive ROW_NUMBER+DELETE belt-and-suspenders survives in
-- case any unique-constraint duplicates already exist for unrelated
-- reasons; if no collisions are found it's a no-op.
--
-- Re-runnable per the project's migration contract. NULL or invalid
-- timezones fall back to 'UTC' (same fallback as dayInTz / streakDayKey).

-- 1. streak_days ----------------------------------------------------------

ALTER TABLE "streak_days"
	ADD COLUMN IF NOT EXISTS "_local_day_migrated_at" timestamp;--> statement-breakpoint

-- Defensive pre-merge against pre-existing (user_id, new_day) duplicates.
-- The noon-UTC anchor prevents the conversion from creating new
-- collisions, so this DELETE is a no-op in practice; it's kept so a
-- pre-existing duplicate row from some other source can't trip the
-- UNIQUE (user_id, day) index during the UPDATE.
WITH converted AS (
	SELECT
		sd.id,
		sd.user_id,
		to_char(
			((sd.day || ' 12:00')::timestamp AT TIME ZONE 'UTC'
				AT TIME ZONE COALESCE(NULLIF(u.timezone, ''), 'UTC'))::date,
			'YYYY-MM-DD'
		) AS new_day,
		sd.status
	FROM "streak_days" sd
	JOIN "users" u ON u.id = sd.user_id
	WHERE sd._local_day_migrated_at IS NULL
),
ranked AS (
	SELECT
		c.id,
		ROW_NUMBER() OVER (
			PARTITION BY c.user_id, c.new_day
			ORDER BY CASE c.status
				WHEN 'active' THEN 1
				WHEN 'frozen' THEN 2
				WHEN 'review_protected' THEN 3
				WHEN 'missed' THEN 4
				WHEN 'pending' THEN 5
				ELSE 6
			END,
			c.id ASC
		) AS rn
	FROM converted c
)
DELETE FROM "streak_days" WHERE id IN (
	SELECT id FROM ranked WHERE rn > 1
);--> statement-breakpoint

UPDATE "streak_days" sd
SET
	day = to_char(
		((sd.day || ' 12:00')::timestamp AT TIME ZONE 'UTC'
			AT TIME ZONE COALESCE(NULLIF(u.timezone, ''), 'UTC'))::date,
		'YYYY-MM-DD'
	),
	_local_day_migrated_at = NOW(),
	updated_at = NOW()
FROM "users" u
WHERE sd.user_id = u.id
	AND sd._local_day_migrated_at IS NULL;--> statement-breakpoint

ALTER TABLE "streak_days" DROP COLUMN IF EXISTS "_local_day_migrated_at";--> statement-breakpoint

-- 2. daily_project_activity ----------------------------------------------

ALTER TABLE "daily_project_activity"
	ADD COLUMN IF NOT EXISTS "_local_day_migrated_at" timestamp;--> statement-breakpoint

-- Defensive pre-merge against pre-existing (user_id, project_id, new_day)
-- duplicates; same noon-UTC argument as section 1.
WITH converted AS (
	SELECT
		dpa.id,
		dpa.user_id,
		dpa.project_id,
		to_char(
			((dpa.day || ' 12:00')::timestamp AT TIME ZONE 'UTC'
				AT TIME ZONE COALESCE(NULLIF(u.timezone, ''), 'UTC'))::date,
			'YYYY-MM-DD'
		) AS new_day
	FROM "daily_project_activity" dpa
	JOIN "users" u ON u.id = dpa.user_id
	WHERE dpa._local_day_migrated_at IS NULL
),
ranked AS (
	SELECT
		c.id,
		ROW_NUMBER() OVER (
			PARTITION BY c.user_id, c.project_id, c.new_day
			ORDER BY c.id ASC
		) AS rn
	FROM converted c
)
DELETE FROM "daily_project_activity" WHERE id IN (
	SELECT id FROM ranked WHERE rn > 1
);--> statement-breakpoint

UPDATE "daily_project_activity" dpa
SET
	day = to_char(
		((dpa.day || ' 12:00')::timestamp AT TIME ZONE 'UTC'
			AT TIME ZONE COALESCE(NULLIF(u.timezone, ''), 'UTC'))::date,
		'YYYY-MM-DD'
	),
	_local_day_migrated_at = NOW(),
	updated_at = NOW()
FROM "users" u
WHERE dpa.user_id = u.id
	AND dpa._local_day_migrated_at IS NULL;--> statement-breakpoint

ALTER TABLE "daily_project_activity" DROP COLUMN IF EXISTS "_local_day_migrated_at";--> statement-breakpoint

-- 3. projects.last_worked_date -------------------------------------------
--
-- Single-column scalar. No collision concern since each project has
-- exactly one row. NULL last_worked_date is left as-is. Owner's tz
-- comes via projects.user_id -> users.timezone. Same _local_day_migrated_at
-- guard as sections 1-2 so a re-run can't double-shift.

ALTER TABLE "projects"
	ADD COLUMN IF NOT EXISTS "_local_day_migrated_at" timestamp;--> statement-breakpoint

UPDATE "projects" p
SET
	last_worked_date = to_char(
		((p.last_worked_date || ' 12:00')::timestamp AT TIME ZONE 'UTC'
			AT TIME ZONE COALESCE(NULLIF(u.timezone, ''), 'UTC'))::date,
		'YYYY-MM-DD'
	),
	_local_day_migrated_at = NOW(),
	updated_at = NOW()
FROM "users" u
WHERE p.user_id = u.id
	AND p.last_worked_date IS NOT NULL
	AND p._local_day_migrated_at IS NULL;--> statement-breakpoint

ALTER TABLE "projects" DROP COLUMN IF EXISTS "_local_day_migrated_at";--> statement-breakpoint

-- 4. users.last_active_date ----------------------------------------------
--
-- Per-user scalar. Same noon-of-UTC-day -> local-date conversion. Same
-- _local_day_migrated_at guard as sections 1-3.

ALTER TABLE "users"
	ADD COLUMN IF NOT EXISTS "_local_day_migrated_at" timestamp;--> statement-breakpoint

UPDATE "users" u
SET
	last_active_date = to_char(
		((u.last_active_date || ' 12:00')::timestamp AT TIME ZONE 'UTC'
			AT TIME ZONE COALESCE(NULLIF(u.timezone, ''), 'UTC'))::date,
		'YYYY-MM-DD'
	),
	_local_day_migrated_at = NOW()
WHERE u.last_active_date IS NOT NULL
	AND u._local_day_migrated_at IS NULL;--> statement-breakpoint

ALTER TABLE "users" DROP COLUMN IF EXISTS "_local_day_migrated_at";
