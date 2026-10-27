-- Capture public Slack help-thread replies from community members who have no
-- linked Macondo account. Previously such replies were dropped on the floor
-- (the events webhook and backfill both required the Slack author to resolve
-- to a Macondo user), so staff never saw them in the internal ticket view.
-- These columns hold the external author's Slack identity for rows inserted
-- with author_kind = 'slack_external' and a null author_user_id; every other
-- row leaves them null and resolves its author via the author_user_id join.
-- Re-runnable via IF NOT EXISTS guards per the repo migration convention.

ALTER TABLE "support_ticket_messages" ADD COLUMN IF NOT EXISTS "slack_author_id" varchar;
--> statement-breakpoint
ALTER TABLE "support_ticket_messages" ADD COLUMN IF NOT EXISTS "slack_author_name" text;
--> statement-breakpoint
ALTER TABLE "support_ticket_messages" ADD COLUMN IF NOT EXISTS "slack_author_image" text;
