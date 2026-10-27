-- Phase 2 of the load-bearing-fruit redesign: shop items can be priced
-- in a specific fruit type instead of gold.
--
-- price_fruit_type IS NULL  → existing behavior, item costs price_hours gold.
-- price_fruit_type IS NOT NULL → item costs price_fruit_amount of that fruit.
--
-- The purchase endpoint validates exactly one of (gold) / (fruit) is the
-- effective price; both columns coexisting on the row is reserved for a
-- future "either currency" feature and rejected at the API layer today.
--
-- regional_pricing JSONB stays gold-only this round; fruit-priced items
-- ignore region overrides.

ALTER TABLE "shop_items"
  ADD COLUMN IF NOT EXISTS "price_fruit_type" text;

ALTER TABLE "shop_items"
  ADD COLUMN IF NOT EXISTS "price_fruit_amount" integer;

ALTER TABLE "shop_items"
  ADD CONSTRAINT "shop_items_fruit_price_amount_positive"
  CHECK ("price_fruit_type" IS NULL OR "price_fruit_amount" > 0);
