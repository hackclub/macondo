-- Shop regional pricing / availability.
-- Adds:
--   users.country, users.region_override    (ISO / ShopRegion codes)
--   shop_items.regional_pricing             (jsonb overrides per region)
--   shop_orders.region                      (ShopRegion used to price order)
-- All fields nullable so existing rows stay identical in behavior.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "country" varchar(2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "region_override" varchar(2);--> statement-breakpoint

ALTER TABLE "shop_items" ADD COLUMN IF NOT EXISTS "regional_pricing" jsonb;--> statement-breakpoint

ALTER TABLE "shop_orders" ADD COLUMN IF NOT EXISTS "region" varchar(2);
