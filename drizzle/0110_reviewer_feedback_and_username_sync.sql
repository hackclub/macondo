-- Reviewer feedback images: images a reviewer attaches to the student-facing
-- decision message (rendered next to decision_user_message on the project page).
-- Username sync tracking: last time the public username/avatar were refreshed
-- from the user's current Slack handle, driving the refresh-username cron.
-- Guarded with IF NOT EXISTS so the migration is re-runnable on prod state.
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "decision_user_message_attachments" jsonb;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "username_synced_at" timestamp;
