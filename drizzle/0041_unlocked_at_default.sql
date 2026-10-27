-- Default currency_transactions.unlocked_at to now() at the column level.
--
-- 0039_pending_fruit added the column without a default because the
-- grandfather backfill needed to run first (the migration sets every
-- existing row to COALESCE(created_at, now())). With the backfill done,
-- ordinary inserts (shop purchases, fruit→gold conversions, referral
-- rewards, staff grants, streak freezes) should produce unlocked rows
-- by default. The only place that writes NULL is the pending-hardware
-- fruit branch inside server/api/internal/ships/[id]/review.post.ts,
-- which passes unlocked_at: null explicitly.

ALTER TABLE "currency_transactions"
  ALTER COLUMN "unlocked_at" SET DEFAULT now();
