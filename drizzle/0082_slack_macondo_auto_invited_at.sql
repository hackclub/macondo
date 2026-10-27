-- Track when (and whether) we've already auto-invited a user to the
-- #macondo Slack channel from the HCA OAuth callback. Once stamped, the
-- callback skips the invite forever — so a user who joins via auto-invite
-- and later /leave's the channel does NOT get re-added on their next
-- sign-in. The timestamp is also useful for audit ("how many users have
-- we auto-invited and when").
--
-- Re-runnable on prod: ADD COLUMN IF NOT EXISTS makes a second run a
-- no-op, the column is nullable so existing rows don't need a default.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "slack_macondo_auto_invited_at" timestamp;
