-- Add the funded-hours attribution columns that were introduced to the
-- ships schema but never shipped as a migration. The review endpoint
-- (server/api/internal/users/[id].get.ts and friends) selects every
-- column on the ships table via drizzle, so missing these triggers a
-- "column ships.needs_funding_hours does not exist" 500 in production.
--
-- Both columns are nullable with no default. Existing ship rows keep
-- NULL, which the approver already treats as "all hours are funded",
-- preserving the original zero-fruit behavior for historical ships.
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "needs_funding_hours" integer;
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "needs_funding_hours_override" integer;
