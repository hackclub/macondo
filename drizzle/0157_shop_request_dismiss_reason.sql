ALTER TABLE "shop_item_requests"
ADD COLUMN IF NOT EXISTS "dismissed_reason" text;
