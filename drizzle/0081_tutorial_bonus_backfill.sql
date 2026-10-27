-- Backfill the missed +1h tutorial bonus on in-flight pending guide ships.
--
-- Pre-fix, server/api/projects/[id]/ship.post.ts had a mutually-exclusive
-- guide hour rule: a guide ship got EITHER 1h tutorial credit (when no
-- hackatime was linked) OR the real hackatime hours (when hackatime was
-- linked), never both. The fix makes the calculation additive
-- (real + bonus). Existing pending ships that were submitted under the
-- old rule WITH hackatime linked are missing the +1h bonus.
--
-- This migration only touches ships that are still pending
-- (under_review or pending_fraud_review) so historical shipped/approved
-- and rewarded rows aren't retroactively rewritten. The earliest-ship
-- AND not-yet-shipped guards prevent the bonus from being added to:
--   - non-guide projects (no bonus owed)
--   - non-earliest ships of a project (only the tutorial submission
--     gets the bonus; updates do not)
--   - guide ships with no hackatime linked (already have
--     hackatime_hours = 1 from the no-hackatime branch; adding +1
--     would double-credit)
--   - shipped / shipped_missing_airtable / rejected (not eligible to
--     mutate)
--
-- Re-runnable on prod: once a ship has been incremented, it no longer
-- matches the cardinality + earliest-ship + no-shipped-sibling guard
-- on a second run, so the UPDATE affects zero rows.

UPDATE "ships"
SET "hackatime_hours" = COALESCE("hackatime_hours", 0) + 1
WHERE "status" IN ('under_review', 'pending_fraud_review')
  AND "project_id" IN (SELECT "id" FROM "projects" WHERE "guide" IS NOT NULL)
  AND COALESCE(array_length("hackatime_projects", 1), 0) > 0
  AND "id" = (
    SELECT MIN(s2."id") FROM "ships" s2 WHERE s2."project_id" = "ships"."project_id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "ships" s3
    WHERE s3."project_id" = "ships"."project_id"
      AND s3."id" <> "ships"."id"
      AND s3."status" IN ('shipped', 'shipped_missing_airtable')
  );
