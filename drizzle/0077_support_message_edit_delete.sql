-- Capture Slack edits and deletes on support ticket messages. The webhook
-- now handles message_changed (edit) and message_deleted (delete) subtypes
-- and updates the same row matched by (ticket_id, slack_ts) instead of
-- silently dropping the event. edited_at and deleted_at drive an "(edited)"
-- / "(deleted)" badge on the internal support page; original_body is the
-- first body we ever saw so reviewers can audit a thread that has been
-- edited multiple times.
ALTER TABLE "support_ticket_messages" ADD COLUMN "edited_at" timestamp;
ALTER TABLE "support_ticket_messages" ADD COLUMN "deleted_at" timestamp;
ALTER TABLE "support_ticket_messages" ADD COLUMN "original_body" text;
