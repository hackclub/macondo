-- Split the combined "Pre/Post Event Accommodation" shop item (prod id 125)
-- into two slug-keyed items, so purchases and cancels can mirror per-item
-- owned counts onto the Airtable users table (pre_accommodation /
-- post_accommodation columns, see setAccommodationCount in server/lib/loops.ts).
--
-- Re-runnable: the rename only matches the pre-split name, and the copy
-- no-ops once the post slug exists (ON CONFLICT on the slug unique index).
-- On databases without the item (fresh dev) both statements are no-ops.
-- name_translations are cleared because the stored translations render the
-- old combined name; the public shop falls back to AI translation of the
-- new names. Descriptions are unchanged, so their translations are kept.
UPDATE "shop_items"
SET "name" = 'Pre-Event Accommodation',
    "slug" = 'pre_event_accommodation',
    "name_translations" = NULL,
    "updated_at" = now()
WHERE "id" = 125
  AND "slug" IS NULL
  AND "name" = 'Pre/Post Event Accommodation';
--> statement-breakpoint
INSERT INTO "shop_items" (
  "slug", "name", "description", "name_translations", "description_translations",
  "price_hours", "price_fruit_type", "price_fruit_amount", "price_fruit_level",
  "price_fruit_category", "image_url", "kind", "fulfillment_provider", "source",
  "grant_amount_cents", "attachment_urls", "inventory_mode", "stock_remaining",
  "max_per_user", "sale_price_hours", "available_until", "available",
  "coming_soon", "requires_shipped_project", "pinned", "extra_fruity",
  "regional_pricing", "modifiers", "category", "created_at", "updated_at"
)
SELECT
  'post_event_accommodation', 'Post-Event Accommodation', "description",
  NULL, "description_translations",
  "price_hours", "price_fruit_type", "price_fruit_amount", "price_fruit_level",
  "price_fruit_category", "image_url", "kind", "fulfillment_provider", "source",
  "grant_amount_cents", "attachment_urls", "inventory_mode", "stock_remaining",
  "max_per_user", "sale_price_hours", "available_until", "available",
  "coming_soon", "requires_shipped_project", "pinned", "extra_fruity",
  "regional_pricing", "modifiers", "category", now(), now()
FROM "shop_items"
WHERE "slug" = 'pre_event_accommodation'
ON CONFLICT ("slug") DO NOTHING;
