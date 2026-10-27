-- Level + category fruit pricing for shop items.
--
-- Today price_fruit_type holds a specific fruit name (e.g. "Watermelon")
-- and the buyer pays price_fruit_amount of that exact fruit. Going
-- forward, new fruit-priced items use price_fruit_level (1..4) plus
-- price_fruit_category ("software" | "hardware") instead, and the buyer
-- can pay with any fruit at that combo. Existing rows keep their
-- price_fruit_type and continue to work; the application layer rejects
-- mixing the two targets on a single row.

ALTER TABLE "shop_items"
  ADD COLUMN IF NOT EXISTS "price_fruit_level" integer;

ALTER TABLE "shop_items"
  ADD COLUMN IF NOT EXISTS "price_fruit_category" text;

ALTER TABLE "shop_items"
  DROP CONSTRAINT IF EXISTS "shop_items_fruit_level_range";

ALTER TABLE "shop_items"
  ADD CONSTRAINT "shop_items_fruit_level_range"
  CHECK ("price_fruit_level" IS NULL OR ("price_fruit_level" BETWEEN 1 AND 4));

ALTER TABLE "shop_items"
  DROP CONSTRAINT IF EXISTS "shop_items_fruit_category_values";

ALTER TABLE "shop_items"
  ADD CONSTRAINT "shop_items_fruit_category_values"
  CHECK ("price_fruit_category" IS NULL OR "price_fruit_category" IN ('software', 'hardware'));

ALTER TABLE "shop_items"
  DROP CONSTRAINT IF EXISTS "shop_items_fruit_level_category_paired";

ALTER TABLE "shop_items"
  ADD CONSTRAINT "shop_items_fruit_level_category_paired"
  CHECK (("price_fruit_level" IS NULL) = ("price_fruit_category" IS NULL));

ALTER TABLE "shop_items"
  DROP CONSTRAINT IF EXISTS "shop_items_fruit_targets_exclusive";

ALTER TABLE "shop_items"
  ADD CONSTRAINT "shop_items_fruit_targets_exclusive"
  CHECK ("price_fruit_type" IS NULL OR "price_fruit_level" IS NULL);

ALTER TABLE "shop_items"
  DROP CONSTRAINT IF EXISTS "shop_items_fruit_level_amount_positive";

ALTER TABLE "shop_items"
  ADD CONSTRAINT "shop_items_fruit_level_amount_positive"
  CHECK ("price_fruit_level" IS NULL OR "price_fruit_amount" > 0);
