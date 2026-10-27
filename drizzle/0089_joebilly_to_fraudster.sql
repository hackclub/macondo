-- Collapse the "joebilly" role into "fraudster". Any user who currently
-- has joebilly gets fraudster (the canonical fraud-team role with
-- hackatime-graph access), and joebilly is stripped from their roles.
-- Mirrors the pattern used by 0088_reviewer_role_split.sql.
--
-- Re-runnable on prod state per the "Migrations must apply to prod" rule:
-- the WHERE clause matches only rows that still contain 'joebilly', and
-- after the first run no row has it, so a second run is a no-op. The
-- conditional append guards against double-adding 'fraudster' for users
-- who already had both roles.

UPDATE "users"
SET "roles" = array_remove(
  CASE
    WHEN 'fraudster' = ANY("roles") THEN "roles"
    ELSE array_append("roles", 'fraudster')
  END,
  'joebilly'
)
WHERE 'joebilly' = ANY("roles");
