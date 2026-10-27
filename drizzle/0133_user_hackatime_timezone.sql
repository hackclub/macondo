-- Provenance marker for the user's Hackatime-reported IANA timezone. When
-- non-null it is authoritative and written through to users.timezone (the
-- column the streak engine and reminder cron read); the browser-sync endpoint
-- defers to it. Nullable; null means no Hackatime tz yet. Re-runnable on prod.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hackatime_timezone" varchar;
