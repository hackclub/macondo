-- Adds an admin-controlled "pin to top" flag to shop items. When true,
-- the public shop forces the item to the top of the grid above the normal
-- available / unavailable partition, ignoring the viewer's currency
-- filter and sort selection. Used by admins to highlight launches or
-- limited-time drops without juggling pricing tricks.
--
-- Default false so every existing item keeps its current ordering.

ALTER TABLE "shop_items"
  ADD COLUMN IF NOT EXISTS "pinned" boolean DEFAULT false NOT NULL;
