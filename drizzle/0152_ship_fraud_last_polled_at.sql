-- Bounded fraud-poll cron cursor. The 2-minute fraud poll previously
-- scanned the lowest 100 matching ship ids (ORDER BY id ASC LIMIT 100) on
-- every tick. Terminally-rejected fraud-note ships and silent/stale shipped
-- ships re-match the predicate forever and occupy the low-id slots, so the
-- window never advanced and higher-id ships with a ready upstream verdict
-- were never re-polled (their fraud_outcome stayed NULL, freezing shop
-- fulfillment). This column lets the poll process the least-recently-polled
-- batch (ORDER BY fraud_last_polled_at ASC NULLS FIRST, LIMIT N) and stamp
-- each scanned ship, so the whole backlog drains across ticks in round-robin
-- instead of being re-walked from the same floor.
-- Re-runnable via IF NOT EXISTS guards per the repo migration convention.

ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "fraud_last_polled_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ships_fraud_last_polled_at_idx" ON "ships" ("fraud_last_polled_at");
