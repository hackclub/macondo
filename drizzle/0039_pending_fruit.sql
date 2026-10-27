-- Pending-fruit gating + build-complete signal.
--
-- Hardware ship rewards become "pending" fruit (unlocked_at IS NULL) at
-- approval time. Approving a subsequent ship marked
-- is_build_complete_submission for the same project flips unlocked_at
-- to that approval timestamp via a single batch UPDATE in the review
-- transaction (see server/api/internal/ships/[id]/review.post.ts).
--
-- Software ship rewards and all legacy rows have unlocked_at set so they
-- behave exactly as before this migration. The grandfather backfill at
-- the bottom guarantees existing balances do not retroactively lock.
--
-- paired_tx_id is reserved for the gifting flow (Phase 3); declared here
-- to keep all currency_transactions schema additions in one migration.

-- 1. Build-complete flag on ships.
ALTER TABLE "ships"
  ADD COLUMN IF NOT EXISTS "is_build_complete_submission" boolean NOT NULL DEFAULT false;

-- 2. Currency-source enum extensions (used by Phase 3 gifting + audit
--    rows for unlock batches; declared now to avoid an enum-only migration
--    later).
ALTER TYPE "currency_transaction_source" ADD VALUE IF NOT EXISTS 'fruit_unlock';
ALTER TYPE "currency_transaction_source" ADD VALUE IF NOT EXISTS 'fruit_gift';

-- 3. Notification-type enum extensions for the unlock + gift events.
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'pending_fruit_unlocked';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'fruit_gift_received';

-- 4. Pending-fruit columns on currency_transactions.
ALTER TABLE "currency_transactions"
  ADD COLUMN IF NOT EXISTS "unlocked_at" timestamp;
ALTER TABLE "currency_transactions"
  ADD COLUMN IF NOT EXISTS "pending_for_project_id" integer
    REFERENCES "projects"("id");
ALTER TABLE "currency_transactions"
  ADD COLUMN IF NOT EXISTS "pending_for_ship_id" integer
    REFERENCES "ships"("id");
ALTER TABLE "currency_transactions"
  ADD COLUMN IF NOT EXISTS "paired_tx_id" integer;

-- 5. Grandfather: every existing row counts as already unlocked. Without
--    this backfill, all historical fruit balances would silently disappear
--    from balance queries the moment the application code starts filtering
--    by unlocked_at IS NOT NULL.
UPDATE "currency_transactions"
   SET "unlocked_at" = COALESCE("created_at", now())
 WHERE "unlocked_at" IS NULL;

-- 6. Partial index on the unlock query (UPDATE ... WHERE
--    pending_for_project_id = X AND unlocked_at IS NULL). Also speeds the
--    profile pending-list endpoint.
CREATE INDEX IF NOT EXISTS "currency_transactions_pending_for_project_idx"
  ON "currency_transactions" ("pending_for_project_id", "user_id")
  WHERE "unlocked_at" IS NULL;
