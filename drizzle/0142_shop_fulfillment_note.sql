-- Optional buyer-authored note to fulfillers on physical shop orders.
-- Captured at checkout (e.g. links to trusted local resellers) and shown
-- to internal fulfillers plus echoed read-only back to the buyer. Stored
-- as plain text; rendered escaped with bare URLs auto-linked.
--
-- Re-runnable on prod (ADD COLUMN IF NOT EXISTS).

ALTER TABLE "shop_orders" ADD COLUMN IF NOT EXISTS "fulfillment_note" text;
