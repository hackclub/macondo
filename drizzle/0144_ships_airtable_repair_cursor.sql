-- Bounded airtable-repair cron cursor. The 30-minute sweep previously
-- rescanned every shipped row with an airtable_record_id on every tick. This
-- column lets the sweep process a recency-filtered batch (ORDER BY
-- last_airtable_repair_at ASC NULLS FIRST, LIMIT N) and stamp each processed
-- ship, so a backlog drains across ticks instead of being re-walked in full.
-- Re-runnable via IF NOT EXISTS guards per the repo migration convention.

ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "last_airtable_repair_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ships_last_airtable_repair_at_idx" ON "ships" ("last_airtable_repair_at");
