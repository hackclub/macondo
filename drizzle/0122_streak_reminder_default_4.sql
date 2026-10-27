-- Move the streak reminder default fire time earlier. The reminder cron
-- fires at local hour (24 - reminder_hours_before_day_end), so the old
-- default of 1 poked users at 23:00 local, one hour before their
-- midnight, which is too late to act on a "log an hour today" nudge
-- (Slack report from Efe). Default 4 restores the legacy 8 PM (20:00
-- local) reminder that left users an evening of runway.
--
-- This only changes the column default for NEW users. Existing rows are
-- moved by scripts/backfill-reminder-hours.ts. ALTER COLUMN SET DEFAULT
-- is idempotent, so this migration is safe to re-run on prod, matching
-- the project rule that every migration must be re-runnable (CLAUDE.md).

ALTER TABLE "users" ALTER COLUMN "reminder_hours_before_day_end" SET DEFAULT 4;
