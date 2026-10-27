-- Phase 3 (gifting / leaderboard / inventory rewrite) was reverted before
-- shipping. paired_tx_id was only used by the gifting endpoint to link
-- the sender + recipient rows of a transfer; with that endpoint gone the
-- column has no readers. Drop it.
--
-- The gifting-related enum values (currency_transaction_source.fruit_gift,
-- notification_type.fruit_gift_received) are left in place — Postgres
-- enum value removal requires recreating the type, and they cost nothing
-- at rest. They can be reused if the gifting feature is revisited.

ALTER TABLE "currency_transactions"
  DROP COLUMN IF EXISTS "paired_tx_id";
