-- Adds an admin-controlled "pin to top" override to synthetic shop
-- items, mirroring the shop_items.pinned flag added in 0061. Nullable
-- so an unset override falls back to the hardcoded default in
-- syntheticShopItems.ts (currently false for every fixed item). When
-- true, the public shop forces the synthetic item to the top of the
-- grid above the regular available / unavailable partition, ignoring
-- the viewer's currency filter and sort selection.

ALTER TABLE "shop_synthetic_overrides"
  ADD COLUMN IF NOT EXISTS "pinned" boolean;
