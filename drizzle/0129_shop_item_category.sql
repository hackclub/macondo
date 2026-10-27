-- Adds the optional browse category to shop_items. Free text, validated
-- app-side against SHOP_ITEM_CATEGORIES (app/data/shopCategories.ts) and
-- its server mirror in server/lib/shop-admin.ts; stored as text so the
-- taxonomy can grow without an enum migration. Powers the category filter
-- chips on the public storefront. Nullable; null = uncategorized.
--
-- Re-runnable per the project's migration contract (ADD COLUMN IF NOT
-- EXISTS).

ALTER TABLE "shop_items"
	ADD COLUMN IF NOT EXISTS "category" text;
