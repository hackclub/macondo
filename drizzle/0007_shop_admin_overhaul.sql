CREATE TYPE "public"."shop_item_kind" AS ENUM('physical', 'grant');--> statement-breakpoint
CREATE TYPE "public"."shop_fulfillment_provider" AS ENUM('internal', 'theseus', 'hcb');--> statement-breakpoint
CREATE TYPE "public"."shop_inventory_mode" AS ENUM('unlimited', 'limited');--> statement-breakpoint
CREATE TYPE "public"."shop_order_status" AS ENUM('pending_internal_fulfillment', 'shipped', 'grant_pending', 'grant_created', 'theseus_submitted', 'external_failure');--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "kind" "shop_item_kind" DEFAULT 'physical' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "fulfillment_provider" "shop_fulfillment_provider" DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "grant_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "attachment_urls" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "inventory_mode" "shop_inventory_mode" DEFAULT 'unlimited' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "stock_remaining" integer;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "sale_ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "item_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "shipping_address" jsonb;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "tracking_number" text;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "external_reference" text;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "fulfillment_error" text;--> statement-breakpoint
UPDATE "shop_orders"
SET "item_snapshot" = jsonb_build_object(
  'id', "shop_items"."id",
  'name', "shop_items"."name",
  'description', "shop_items"."description",
  'image_url', "shop_items"."image_url",
  'kind', 'physical',
  'fulfillment_provider', 'internal',
  'price_hours', "shop_items"."price_hours",
  'price_gold', "shop_items"."price_hours" * 10,
  'grant_amount_cents', NULL,
  'attachment_urls', COALESCE(to_jsonb("shop_items"."attachment_urls"), '[]'::jsonb)
)
FROM "shop_items"
WHERE "shop_orders"."item_id" = "shop_items"."id";--> statement-breakpoint
ALTER TABLE "shop_orders" ALTER COLUMN "item_snapshot" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_orders" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "shop_orders"
ALTER COLUMN "status" TYPE "shop_order_status"
USING CASE
  WHEN "status" = 'pending' THEN 'pending_internal_fulfillment'::"shop_order_status"
  WHEN "status" = 'shipped' THEN 'shipped'::"shop_order_status"
  WHEN "status" = 'grant_pending' THEN 'grant_pending'::"shop_order_status"
  WHEN "status" = 'grant_created' THEN 'grant_created'::"shop_order_status"
  WHEN "status" = 'theseus_submitted' THEN 'theseus_submitted'::"shop_order_status"
  WHEN "status" = 'external_failure' THEN 'external_failure'::"shop_order_status"
  ELSE 'pending_internal_fulfillment'::"shop_order_status"
END;--> statement-breakpoint
ALTER TABLE "shop_orders" ALTER COLUMN "status" SET DEFAULT 'pending_internal_fulfillment';--> statement-breakpoint
