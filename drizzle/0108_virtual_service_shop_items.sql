-- Virtual service shop items.
--
-- Adds a non-shipping, non-grant item kind whose orders are immediately
-- marked done at purchase time. Re-runnable because enum additions use
-- IF NOT EXISTS.

ALTER TYPE "public"."shop_item_kind" ADD VALUE IF NOT EXISTS 'virtual_service';--> statement-breakpoint
ALTER TYPE "public"."shop_order_status" ADD VALUE IF NOT EXISTS 'service_activated';--> statement-breakpoint

UPDATE "shop_items"
SET
  "kind" = 'virtual_service'::shop_item_kind,
  "fulfillment_provider" = 'internal'::shop_fulfillment_provider,
  "updated_at" = now()
WHERE "slug" = 'travel_stipend'
  AND "kind" = 'experience'::shop_item_kind
  AND "fulfillment_provider" = 'internal_synthetic'::shop_fulfillment_provider;--> statement-breakpoint
