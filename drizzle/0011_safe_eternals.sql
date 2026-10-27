CREATE TYPE "public"."shop_fulfillment_provider" AS ENUM('internal', 'theseus', 'hcb');--> statement-breakpoint
CREATE TYPE "public"."shop_inventory_mode" AS ENUM('unlimited', 'limited');--> statement-breakpoint
CREATE TYPE "public"."shop_item_kind" AS ENUM('physical', 'grant');--> statement-breakpoint
CREATE TYPE "public"."shop_order_status" AS ENUM('pending_internal_fulfillment', 'shipped', 'grant_pending', 'grant_created', 'theseus_submitted', 'external_failure');--> statement-breakpoint
CREATE TABLE "internal_oauth_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"token_type" text,
	"scope" text,
	"expires_at" timestamp,
	"connected_by_user_id" text,
	"external_user_id" text,
	"external_user_email" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "internal_oauth_connections_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
ALTER TABLE "projects" RENAME COLUMN "from_guide" TO "guide";--> statement-breakpoint
ALTER TABLE "shop_orders" ALTER COLUMN "status" SET DEFAULT 'pending_internal_fulfillment'::"public"."shop_order_status";--> statement-breakpoint
ALTER TABLE "shop_orders" ALTER COLUMN "status" SET DATA TYPE "public"."shop_order_status" USING "status"::"public"."shop_order_status";--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN "software_override_hours" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN "software_override_reason" text;--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN "decision_justification" text;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "kind" "shop_item_kind" DEFAULT 'physical' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "fulfillment_provider" "shop_fulfillment_provider" DEFAULT 'internal' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "grant_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "attachment_urls" text[] DEFAULT ARRAY[]::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "inventory_mode" "shop_inventory_mode" DEFAULT 'unlimited' NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "stock_remaining" integer;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "sale_ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "quantity" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "item_snapshot" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "shipping_address" jsonb;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "tracking_number" text;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "external_reference" text;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN "fulfillment_error" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "completed_guides" text[];--> statement-breakpoint
ALTER TABLE "internal_oauth_connections" ADD CONSTRAINT "internal_oauth_connections_connected_by_user_id_users_id_fk" FOREIGN KEY ("connected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;