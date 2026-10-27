-- Hackatime sync now stores raw total_seconds alongside the floored hour
-- count. The old hours-based delta discarded partial-hour activity, so
-- a user who coded for less than the gap to the next whole hour since
-- their last sync got delta=0 and their streak silently did not extend.
-- Nullable so the first sync after deploy is a no-op (we don't want to
-- credit accumulated all-time seconds as "today's activity").

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_hackatime_total_seconds" integer;
