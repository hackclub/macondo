-- Convert ship.software_override_hours and ship.override_hours from
-- integer to numeric(10, 2) so reviewers can deflate to fractional
-- hours (e.g. 2.5h) when Hackatime evidence doesn't justify a whole
-- hour. Existing integer rows cast losslessly into numeric.
--
-- Drop + re-add the DEFAULT around each ALTER so postgres doesn't have
-- to re-cast the old integer default expression into numeric mid-rewrite
-- (some pg versions are picky about this and fail with a domain error).
-- The intermediate window where the column has no default is safe: the
-- migration runs inside a single transaction, and there are no inserts
-- racing it during deploy.

ALTER TABLE "ships"
  ALTER COLUMN "software_override_hours" DROP DEFAULT;
ALTER TABLE "ships"
  ALTER COLUMN "software_override_hours" TYPE numeric(10, 2) USING "software_override_hours"::numeric(10, 2);
ALTER TABLE "ships"
  ALTER COLUMN "software_override_hours" SET DEFAULT 0;

ALTER TABLE "ships"
  ALTER COLUMN "override_hours" DROP DEFAULT;
ALTER TABLE "ships"
  ALTER COLUMN "override_hours" TYPE numeric(10, 2) USING "override_hours"::numeric(10, 2);
ALTER TABLE "ships"
  ALTER COLUMN "override_hours" SET DEFAULT 0;
