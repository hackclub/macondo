-- Fixed "Stickers" shop item with a hard 1-per-person cap.
--
-- Stickers are meant to be a welcome / low-cost swag item; capping to one
-- per user keeps a single person from clearing every sheet we have. The
-- max_per_user column (migration 0033, oh wait, 0031) enforces this at
-- purchase time inside orders.post.ts.
--
-- Idempotent: the INSERT is gated by WHERE NOT EXISTS on the name so a
-- rerun is a no-op. Admins can edit price / image / translations from
-- /internal/shop afterwards; this migration only sets sensible defaults.

INSERT INTO "shop_items" (
  "name",
  "description",
  "price_hours",
  "image_url",
  "kind",
  "fulfillment_provider",
  "attachment_urls",
  "inventory_mode",
  "stock_remaining",
  "max_per_user",
  "available",
  "coming_soon",
  "created_at",
  "updated_at"
)
SELECT
  'Stickers',
  'A Macondo sticker pack, mailed to your door. One pack per person.',
  1,                       -- price_hours=1 → 10 gold; admin can bump later
  NULL,                    -- image_url unset; admin uploads from the editor
  'physical',
  'internal',              -- staff fulfill manually; switch to theseus later if desired
  ARRAY[]::text[],
  'unlimited',
  NULL,
  1,                       -- the whole point: hard cap of 1 per user
  TRUE,
  FALSE,
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "shop_items" WHERE "name" = 'Stickers'
);
