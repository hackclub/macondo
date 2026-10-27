-- Idempotency key for retry-safe support ticket reply inserts. The web
-- reply UI generates a UUID per submit; the reply endpoints check for an
-- existing row with the same (ticket_id, client_dedup_key) before
-- inserting a new one. Slack-originated rows leave it null because the
-- Slack webhook already dedupes via the slack event id (Redis 5min TTL)
-- and the inbound event_id check.
--
-- Partial unique index: only enforces uniqueness when client_dedup_key
-- is NOT NULL, so legacy rows and Slack rows can coexist as nulls.

ALTER TABLE "support_ticket_messages"
  ADD COLUMN IF NOT EXISTS "client_dedup_key" varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS "support_ticket_messages_dedup_unique"
  ON "support_ticket_messages" ("ticket_id", "client_dedup_key")
  WHERE "client_dedup_key" IS NOT NULL;
