-- Slack-mirror bookkeeping on announcements. A broadcast can now also post to
-- #macondo-bulletin (spoofed as the human author). We record the channel +
-- message ts (for a later edit/recall) and the post time, which doubles as the
-- idempotency guard: a row already posted to Slack is never reposted.
-- posted_to_site=false marks Slack-only custom posts that skip the per-user
-- notification fan-out. author_spoofed=true when the message wore the author's
-- handle + avatar (vs the Capybara bot).
--
-- Re-runnable on prod (ADD COLUMN IF NOT EXISTS).

ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "slack_channel_id" varchar;
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "slack_message_ts" varchar;
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "posted_to_slack_at" timestamp;
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "posted_to_site" boolean DEFAULT true NOT NULL;
ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "author_spoofed" boolean DEFAULT true NOT NULL;
