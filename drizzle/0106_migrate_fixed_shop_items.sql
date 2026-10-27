-- Migrate the three "fixed" (code-defined) shop items into real
-- shop_items rows so admins manage them through the normal editor and
-- the codebase stops carrying the synthetic items / overrides split.
--
-- Schema:
--   * Add slug text column with a unique index. Code-fulfilled items
--     reference rows by slug ("streak_freeze") rather than by an
--     auto-generated numeric id, so future migrations or admin renames
--     can't break the dispatch in shop/orders.post.ts.
--   * Extend shop_item_kind with the existing synthetic kinds
--     (consumable, experience) so the migrated rows keep their semantic
--     type instead of being squashed into "physical".
--   * Extend shop_fulfillment_provider with internal_synthetic so the
--     order endpoint can detect "this item is fulfilled by special
--     code" via the column rather than a hardcoded id list.
--
-- Data:
--   Seed streak_freeze, event_invite, travel_stipend. When the
--   shop_synthetic_overrides table still exists (first run) we
--   COALESCE the admin overrides over the hardcoded baselines so the
--   migrated row matches whatever the admin had configured. On a
--   re-run (table already dropped) we fall back to the baselines, but
--   the ON CONFLICT (slug) guard makes that path a no-op since the
--   rows already exist.
--
-- Cleanup:
--   Drop shop_synthetic_overrides at the end. The synthetic items
--   code path goes away in the same PR.

ALTER TYPE "public"."shop_item_kind" ADD VALUE IF NOT EXISTS 'consumable';--> statement-breakpoint
ALTER TYPE "public"."shop_item_kind" ADD VALUE IF NOT EXISTS 'experience';--> statement-breakpoint
ALTER TYPE "public"."shop_fulfillment_provider" ADD VALUE IF NOT EXISTS 'internal_synthetic';--> statement-breakpoint

ALTER TABLE "shop_items" ADD COLUMN IF NOT EXISTS "slug" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shop_items_slug_unique" ON "shop_items" ("slug");--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'shop_synthetic_overrides'
  ) THEN
    -- First-run path: copy admin overrides into the new rows.
    INSERT INTO "shop_items" (
      "slug", "name", "description",
      "name_translations", "description_translations",
      "price_hours", "image_url",
      "kind", "fulfillment_provider",
      "attachment_urls", "inventory_mode",
      "available", "coming_soon", "requires_shipped_project",
      "pinned", "extra_fruity",
      "created_at", "updated_at"
    )
    SELECT
      'streak_freeze',
      COALESCE(o."name", 'Streak Freeze'),
      COALESCE(o."description",
        'Protects your streak from one missed day. Automatically consumed when your streak would otherwise break. Stack up to 5.'),
      o."name_translations",
      o."description_translations",
      COALESCE(o."price_hours", 5),
      o."image_url",
      'consumable'::shop_item_kind,
      'internal_synthetic'::shop_fulfillment_provider,
      ARRAY[]::text[],
      'unlimited'::shop_inventory_mode,
      TRUE,
      COALESCE(o."coming_soon", FALSE),
      FALSE,
      COALESCE(o."pinned", FALSE),
      FALSE,
      now(),
      now()
    FROM (VALUES (1)) AS d(dummy)
    LEFT JOIN "shop_synthetic_overrides" o
      ON o."synthetic_id" = 'streak_freeze'
    ON CONFLICT ("slug") DO NOTHING;

    INSERT INTO "shop_items" (
      "slug", "name", "description",
      "name_translations", "description_translations",
      "price_hours", "image_url",
      "kind", "fulfillment_provider",
      "attachment_urls", "inventory_mode",
      "available", "coming_soon", "requires_shipped_project",
      "pinned", "extra_fruity",
      "created_at", "updated_at"
    )
    SELECT
      'event_invite',
      COALESCE(o."name", 'Event Invite'),
      COALESCE(o."description",
        'An invitation to an upcoming in-person Hack Club event. Launching soon, stay tuned.'),
      o."name_translations",
      o."description_translations",
      COALESCE(o."price_hours", 0),
      o."image_url",
      'experience'::shop_item_kind,
      'internal_synthetic'::shop_fulfillment_provider,
      ARRAY[]::text[],
      'unlimited'::shop_inventory_mode,
      TRUE,
      COALESCE(o."coming_soon", TRUE),
      TRUE,
      COALESCE(o."pinned", FALSE),
      FALSE,
      now(),
      now()
    FROM (VALUES (1)) AS d(dummy)
    LEFT JOIN "shop_synthetic_overrides" o
      ON o."synthetic_id" = 'event_invite'
    ON CONFLICT ("slug") DO NOTHING;

    INSERT INTO "shop_items" (
      "slug", "name", "description",
      "name_translations", "description_translations",
      "price_hours", "image_url",
      "kind", "fulfillment_provider",
      "attachment_urls", "inventory_mode",
      "available", "coming_soon", "requires_shipped_project",
      "pinned", "extra_fruity",
      "created_at", "updated_at"
    )
    SELECT
      'travel_stipend',
      COALESCE(o."name", 'Travel Stipend'),
      COALESCE(o."description",
        'Covers the cost of getting to a Hack Club event. Launching soon, stay tuned.'),
      o."name_translations",
      o."description_translations",
      COALESCE(o."price_hours", 0),
      o."image_url",
      'experience'::shop_item_kind,
      'internal_synthetic'::shop_fulfillment_provider,
      ARRAY[]::text[],
      'unlimited'::shop_inventory_mode,
      TRUE,
      COALESCE(o."coming_soon", TRUE),
      TRUE,
      COALESCE(o."pinned", FALSE),
      FALSE,
      now(),
      now()
    FROM (VALUES (1)) AS d(dummy)
    LEFT JOIN "shop_synthetic_overrides" o
      ON o."synthetic_id" = 'travel_stipend'
    ON CONFLICT ("slug") DO NOTHING;
  ELSE
    -- Re-run path: overrides table is already dropped. The rows we
    -- care about should already exist from the prior run; the
    -- baseline INSERTs below are belt-and-suspenders in case the
    -- prior run failed between the inserts and the drop.
    INSERT INTO "shop_items" (
      "slug", "name", "description", "price_hours",
      "kind", "fulfillment_provider",
      "attachment_urls", "inventory_mode",
      "available", "coming_soon", "requires_shipped_project",
      "pinned", "extra_fruity",
      "created_at", "updated_at"
    )
    VALUES
      (
        'streak_freeze',
        'Streak Freeze',
        'Protects your streak from one missed day. Automatically consumed when your streak would otherwise break. Stack up to 5.',
        5,
        'consumable'::shop_item_kind,
        'internal_synthetic'::shop_fulfillment_provider,
        ARRAY[]::text[],
        'unlimited'::shop_inventory_mode,
        TRUE, FALSE, FALSE, FALSE, FALSE,
        now(), now()
      ),
      (
        'event_invite',
        'Event Invite',
        'An invitation to an upcoming in-person Hack Club event. Launching soon, stay tuned.',
        0,
        'experience'::shop_item_kind,
        'internal_synthetic'::shop_fulfillment_provider,
        ARRAY[]::text[],
        'unlimited'::shop_inventory_mode,
        TRUE, TRUE, TRUE, FALSE, FALSE,
        now(), now()
      ),
      (
        'travel_stipend',
        'Travel Stipend',
        'Covers the cost of getting to a Hack Club event. Launching soon, stay tuned.',
        0,
        'experience'::shop_item_kind,
        'internal_synthetic'::shop_fulfillment_provider,
        ARRAY[]::text[],
        'unlimited'::shop_inventory_mode,
        TRUE, TRUE, TRUE, FALSE, FALSE,
        now(), now()
      )
    ON CONFLICT ("slug") DO NOTHING;
  END IF;
END $$;--> statement-breakpoint

DROP TABLE IF EXISTS "shop_synthetic_overrides";
