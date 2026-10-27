-- 0103_hca_refresh_token.sql
-- Add server-side HCA OAuth refresh-token storage so the server can
-- re-sync a user's HCA identity (verification_status, ysws_eligible,
-- pii_locker.birthday, ...) without forcing the user through a full
-- sign-out / sign-in. Captured by /api/auth/callback on every sign-in
-- and refreshed by server/lib/hca.ts:syncHcaIdentity using HCA's
-- refresh-grant.
--
-- hca_refresh_token: the OAuth refresh token returned by HCA. Server-
--   only, never returned by /api/auth/me. HCA may rotate the value
--   on each refresh, so syncHcaIdentity overwrites this column when a
--   new value comes back.
-- hca_last_sync_at:  timestamp of the last successful syncHcaIdentity
--   call. Drives the per-user cooldown on the canShipProject probe and
--   the prioritization order in the periodic resync cron.
--
-- IF NOT EXISTS guards make this re-runnable on prod state per the
-- project rule that every drizzle migration must be re-runnable.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hca_refresh_token" text;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hca_last_sync_at" timestamp;
