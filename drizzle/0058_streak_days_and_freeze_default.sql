-- Streak overhaul migration. Three things at once:
--
-- 1. Streak freezes default jumps from 0 to 5. Existing users with fewer
--    than 5 freezes are topped up to 5 in a single UPDATE so the auto
--    consume path in checkStreakFreshness has stock to draw from on its
--    first run. Users above 5 are left alone (paranoia, the cap should
--    keep this from happening but in case prior code wrote a higher value).
--
-- 2. Two new user columns for the daily reminder DM job:
--    preferred_reminder_hour (0-23 local hour to fire) and
--    streak_slack_notifications (per-user opt-out).
--
-- 3. New streak_days table with a status enum. One row per (user_id, day)
--    where day is YYYY-MM-DD in the user's IANA timezone. Drives the
--    profile calendar widget and the streak audit trail.

ALTER TABLE "users"
  ALTER COLUMN "streak_freezes_remaining" SET DEFAULT 5;

UPDATE "users"
  SET "streak_freezes_remaining" = 5
  WHERE "streak_freezes_remaining" < 5;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "preferred_reminder_hour" integer NOT NULL DEFAULT 20;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "streak_slack_notifications" boolean NOT NULL DEFAULT true;

DO $$ BEGIN
  CREATE TYPE "streak_day_status" AS ENUM ('pending', 'active', 'frozen', 'missed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "streak_days" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "day" varchar(10) NOT NULL,
  "status" "streak_day_status" DEFAULT 'pending' NOT NULL,
  "seconds_logged" integer DEFAULT 0 NOT NULL,
  "had_journal" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "streak_days"
    ADD CONSTRAINT "streak_days_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "streak_days_user_day_uniq"
  ON "streak_days" ("user_id", "day");

CREATE INDEX IF NOT EXISTS "streak_days_user_idx"
  ON "streak_days" ("user_id");

CREATE INDEX IF NOT EXISTS "streak_days_day_idx"
  ON "streak_days" ("day");
