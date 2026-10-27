-- Retire the generic "reviewer" role and default every existing reviewer
-- to "software_reviewer". Hardware specialists must be re-granted the
-- "hardware_reviewer" role explicitly after this runs. The narrower
-- software_reviewer / hardware_reviewer roles already exist in the policy
-- file; this migration moves the data over to match.
--
-- Re-runnable on prod state per the "Migrations must apply to prod" rule:
-- the WHERE clause matches only rows that still contain 'reviewer', and
-- after the first run no row has it, so a second run is a no-op. The
-- conditional append guards against double-adding 'software_reviewer' for
-- users who already had both roles.

UPDATE "users"
SET "roles" = array_remove(
  CASE
    WHEN 'software_reviewer' = ANY("roles") THEN "roles"
    ELSE array_append("roles", 'software_reviewer')
  END,
  'reviewer'
)
WHERE 'reviewer' = ANY("roles");
