-- Adds a "source" indicator to shop items so shoppers know whether the
-- physical item ships from Hack Club HQ stock or from a local merchant
-- (Amazon and similar). The existing `fulfillment_provider` enum is
-- about who handles fulfillment mechanics (internal ops vs Theseus vs
-- HCB grants), which is a separate axis from where the goods are
-- sourced from.
--
-- source = 'hq'    , ships from Hack Club HQ stock
-- source = 'local' , sourced from a local merchant (Amazon, etc.)
-- source = NULL    , not applicable (grants don't ship anything physical)
--
-- Backfill: every existing physical item historically ships from HQ, so
-- mark them as source = 'hq'. Grants are left null. The column has no
-- DB-level default so future inserts (admin form) supply the value
-- explicitly through normalizeShopItemBody.

DO $$ BEGIN
  CREATE TYPE "shop_item_source" AS ENUM ('hq', 'local');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

ALTER TABLE "shop_items"
  ADD COLUMN IF NOT EXISTS "source" "shop_item_source";
--> statement-breakpoint

UPDATE "shop_items"
  SET "source" = 'hq'
  WHERE "kind" = 'physical' AND "source" IS NULL;
