-- User-submitted shop item request queue.
--
-- The public /shop page has a "Haven't found what you like? Request it here"
-- form that writes into this table. Admins at /internal/shop-requests can
-- cluster near-duplicates via AI (cluster_id), auto-lookup retailer pricing
-- (pricing_info), and promote a request into a real shop_items entry
-- (promoted_to_item_id). Rows are never deleted; they're dismissed or
-- promoted for an audit trail.

CREATE TABLE IF NOT EXISTS "shop_item_requests" (
  "id"                   serial PRIMARY KEY,
  "user_id"              text NOT NULL REFERENCES "users"("id"),
  "name"                 text NOT NULL,
  "description"          text,
  "store_url"            text,
  "image_url"            text,
  "cluster_id"           integer,
  "pricing_info"         jsonb,
  "promoted_to_item_id"  integer REFERENCES "shop_items"("id"),
  "dismissed_at"         timestamp,
  "dismissed_by"         text REFERENCES "users"("id"),
  "created_at"           timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "shop_item_requests_user_id_idx"
  ON "shop_item_requests" ("user_id");

CREATE INDEX IF NOT EXISTS "shop_item_requests_open_idx"
  ON "shop_item_requests" ("created_at")
  WHERE "promoted_to_item_id" IS NULL AND "dismissed_at" IS NULL;
