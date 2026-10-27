-- Priority payout restrictions.
--
-- ARI's review.approved webhook now carries `priority: true` when the maker
-- requested priority review (offered only to event attendees). Gold paid out
-- from such an approval must be spendable ONLY on a staff-selected subset of
-- shop items:
--
--   ships.ari_priority                  the approval that decided this ship
--                                       carried priority (stamped by
--                                       buildApproveSnapshot on every park)
--   currency_transactions.priority      ship_reward gold earned from a
--                                       priority approval; excluded from the
--                                       spendable balance for any item that
--                                       is not priority-eligible
--   shop_items.priority_eligible        admin-selected "priority gold may buy
--                                       this" flag (internal shop editor)
--
-- Idempotent and re-runnable per the project's migration contract.

ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "ari_priority" boolean NOT NULL DEFAULT false;

ALTER TABLE "currency_transactions" ADD COLUMN IF NOT EXISTS "priority" boolean NOT NULL DEFAULT false;

ALTER TABLE "shop_items" ADD COLUMN IF NOT EXISTS "priority_eligible" boolean NOT NULL DEFAULT false;
