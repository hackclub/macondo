-- Non-binding "are you planning on coming to Bogotá?" answer, captured by the
-- app-wide popup (app/components/EventAttendancePopup.vue) and mirrored onto
-- the Airtable users table by setEventAttendanceIntent (server/lib/loops.ts).
--
-- NULL means "hasn't answered" and is the state that keeps the popup coming
-- back on every page load; dismissing with the X deliberately writes nothing.
-- Both columns are nullable with no default, so this is additive and safe for a
-- rolling deploy: containers still serving the previous build never select
-- them, and the new build needs them present before it can serve a session.
--
-- Re-runnable per the migration contract: guarded CREATE TYPE, ADD COLUMN IF
-- NOT EXISTS.

DO $$ BEGIN
  CREATE TYPE "event_attendance_intent" AS ENUM ('yes', 'no');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "event_attendance_intent" "event_attendance_intent";
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "event_attendance_intent_at" timestamp;
