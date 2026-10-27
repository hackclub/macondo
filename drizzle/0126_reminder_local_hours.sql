-- Adds reminder_local_hours: an array of local wall-clock hours (1..23) the
-- streak reminder DM may fire at, so a user can pick multiple reminder times in
-- a day. The cron (server/lib/streak-reminders.ts) fires at each selected hour
-- the user has not yet qualified for the day; a null array falls back to the
-- single reminder_hours_before_day_end value, so existing users need no backfill.
--
-- IF NOT EXISTS makes this re-runnable on prod per the migration rule. A bulk
-- backfill UPDATE was intentionally omitted: it forces row rewrites that trip a
-- pre-existing users_email_unique duplicate on prod, and the null-fallback
-- already covers existing users. Backfill separately, after the duplicate
-- emails are resolved, only if pre-population is ever wanted.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reminder_local_hours" integer[];
