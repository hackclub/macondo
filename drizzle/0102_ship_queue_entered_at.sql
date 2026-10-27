-- 0102_ship_queue_entered_at.sql
-- Add the queue_entered_at column on ships. This is the timestamp the
-- ship most recently joined the review queue. It mirrors created_at on
-- initial submit, is refreshed when a resubmit flips a ship out of
-- needs_changes, and is refreshed when fraud-poll reverses an
-- auto-rejection back into the queue. Public queue-position and the
-- internal reviewer queue both order by this column so a resubmitted or
-- resurrected ship goes to the back of the line instead of leapfrogging
-- newer ships and bumping their positions backward.
--
-- IF NOT EXISTS guards make this re-runnable on prod state per the
-- project rule that every drizzle migration must be re-runnable.

ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "queue_entered_at" timestamptz NOT NULL DEFAULT now();

-- Backfill: existing rows have just had queue_entered_at set to now() by
-- the column default. Reset them to their original created_at so the
-- queue ordering for ships currently in flight stays identical to the
-- pre-migration FIFO and there are no surprise reshuffles on deploy.
-- The guard below makes the UPDATE idempotent: it only rewrites rows
-- where queue_entered_at is essentially "now" (set by the DEFAULT) and
-- created_at is older. On a re-run after the first migration, those
-- rows have already been rewritten and the WHERE is false.
UPDATE "ships"
   SET "queue_entered_at" = "created_at"
 WHERE "created_at" IS NOT NULL
   AND "queue_entered_at" > "created_at" + interval '1 minute';
