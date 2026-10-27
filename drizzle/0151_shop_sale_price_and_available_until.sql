-- Shop "on sale" support, plus a rename to remove naming confusion.
--
-- 1. Rename shop_items.sale_ends_at -> available_until. The column never
--    changed price; it only delists/hides the item once the timestamp
--    passes. With a real per-item sale price arriving below, "sale_ends_at"
--    read as if it ended a sale, so it is renamed to what it actually does.
-- 2. Add shop_items.sale_price_hours: an optional discounted gold price (in
--    hours; gold = hours * 10). When set below the regular price_hours the
--    item is "on sale" and both the displayed and charged price use it.
--
-- Guarded so the migration is re-runnable on prod state (CLAUDE.md rule):
-- the rename only fires when the old column still exists and the new one
-- does not, and the add uses IF NOT EXISTS.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_items' AND column_name = 'sale_ends_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_items' AND column_name = 'available_until'
  ) THEN
    ALTER TABLE "shop_items" RENAME COLUMN "sale_ends_at" TO "available_until";
  END IF;
END $$;--> statement-breakpoint

ALTER TABLE "shop_items" ADD COLUMN IF NOT EXISTS "sale_price_hours" integer;
