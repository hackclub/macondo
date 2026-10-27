-- Shop item modifiers (variants).
-- Adds:
--   shop_items.modifiers           jsonb config of single/multi-select options
--                                  with stackable price_delta_hours
--   shop_orders.selected_modifiers jsonb resolved picks frozen at purchase time
-- Both nullable so existing rows continue to behave as before.

ALTER TABLE "shop_items" ADD COLUMN IF NOT EXISTS "modifiers" jsonb;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN IF NOT EXISTS "selected_modifiers" jsonb;
