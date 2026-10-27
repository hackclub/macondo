-- Adds a per-item flag that gates purchase on the buyer having shipped
-- at least one project. Used for items like "Customs" (import-tax
-- reimbursement) and forthcoming experiences (Event Invite, Travel
-- Stipend) that only make sense once a user has actually shipped.
--
-- Default false so all existing items keep their current behavior. The
-- companion UPDATE flips it on for the prod "Customs" item by name; if
-- the row isn't present in this DB (dev / fresh install) the UPDATE is
-- a no-op.

ALTER TABLE "shop_items"
  ADD COLUMN IF NOT EXISTS "requires_shipped_project" boolean DEFAULT false NOT NULL;

UPDATE "shop_items"
  SET "requires_shipped_project" = true
  WHERE "name" = 'Customs';
