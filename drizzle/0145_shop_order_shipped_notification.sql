-- Adds a notification_type enum value fired when staff mark an internal
-- physical shop order as shipped (/api/internal/shop/orders/[id]/ship.patch.ts).
-- The buyer gets an in-app notification plus a Slack DM carrying the tracking
-- number so they know their package is on its way.
--
-- ADD VALUE must run outside a transaction (Postgres disallows enum mutations
-- inside a tx block). IF NOT EXISTS keeps this re-runnable on prod, matching
-- the project rule that every migration is idempotent (see CLAUDE.md).

ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'shop_order_shipped';
