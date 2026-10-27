-- Per-user, per-project, per-day activity rollup. Powers the DAU metric:
-- a user is "daily active" on a day when at least one row for that day has
-- (journal_seconds + hackatime_seconds) >= 300 (five minutes).
--
-- Source columns are split so we can audit which path drove activity:
--   - journal_seconds: sum of (un-archived) journal hours converted to
--     integer seconds, kept in sync by the journal create/edit/archive
--     flows in server/api/projects/[id]/journals*.
--   - hackatime_seconds: per-project, per-day seconds from hackatime,
--     populated by the batch sync (server/lib/hackatime-batch-sync.ts)
--     and only counted when the lynx project has a non-empty
--     hackatime_projects array and owns the hackatime project name under
--     the earliest-claim dedupe rule used by streaks.
--
-- `day` is "YYYY-MM-DD" in the user's IANA timezone, matching how the
-- streak system computes "today" so DAU and streaks agree on day
-- boundaries.
--
-- Backfill: server/lib/daily-activity.ts:backfillUserActivity walks
-- journals and hackatime per-day deltas and upserts these rows. The
-- script in scripts/backfill-daily-activity.ts loops every linked user.

CREATE TABLE IF NOT EXISTS "daily_project_activity" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "project_id" integer NOT NULL,
  "day" varchar(10) NOT NULL,
  "journal_seconds" integer NOT NULL DEFAULT 0,
  "hackatime_seconds" integer NOT NULL DEFAULT 0,
  "updated_at" timestamp NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "daily_project_activity"
    ADD CONSTRAINT "daily_project_activity_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "daily_project_activity"
    ADD CONSTRAINT "daily_project_activity_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "daily_project_activity_user_project_day_uniq"
  ON "daily_project_activity" ("user_id", "project_id", "day");

CREATE INDEX IF NOT EXISTS "daily_project_activity_day_idx"
  ON "daily_project_activity" ("day");

CREATE INDEX IF NOT EXISTS "daily_project_activity_user_day_idx"
  ON "daily_project_activity" ("user_id", "day");
