-- Capybara ticket-inactivity auto-resolve support. auto_resolve_warned_at on a
-- ticket marks that the "will be resolved in 24h" warning has been posted; the
-- hourly sweep reads/clears it. The partial index serves the sweep's "latest
-- public human message per ticket" lateral lookups (non-deleted, non-internal
-- user messages only).
--
-- Re-runnable on prod per the migration rules (ADD COLUMN IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS).

ALTER TABLE "support_tickets" ADD COLUMN IF NOT EXISTS "auto_resolve_warned_at" timestamp;

CREATE INDEX IF NOT EXISTS "support_ticket_messages_public_latest_idx"
  ON "support_ticket_messages" ("ticket_id", "created_at")
  WHERE "is_internal_note" = false AND "deleted_at" IS NULL AND "author_kind" = 'user';
