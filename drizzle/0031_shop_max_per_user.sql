-- Per-user purchase cap on shop items.
--
-- `max_per_user` is NULL by default (no cap). When set, orders.post.ts
-- counts the buyer's existing orders for the same item excluding
-- external_failure, and rejects new purchases once quantity would exceed
-- the cap. external_failure is the only non-counted status because it
-- represents an order that never actually reached the user (failed
-- delivery / refund-ish) — all other statuses mean the item either has
-- shipped or is in the fulfillment pipeline.

ALTER TABLE "shop_items" ADD COLUMN IF NOT EXISTS "max_per_user" integer;
