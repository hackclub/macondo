-- Dedupe existing hackatime_projects arrays. Prior to this migration the
-- project PATCH endpoint accepted arrays with repeated entries, which let a
-- single hackatime project name appear N times and caused the ship-hours
-- batch resnapshot, the streak day-threshold check, and the DAU rollup to
-- count the same project once per repeat. The PATCH handler now rejects
-- duplicates and the read-side sums are dedup-safe; this migration cleans
-- up rows that were written before the fix.
--
-- The cardinality / COUNT(DISTINCT) predicate makes this a no-op for rows
-- that are already clean, so it's cheap to re-run.

UPDATE "projects"
SET "hackatime_projects" = ARRAY(SELECT DISTINCT unnest("hackatime_projects"))
WHERE "hackatime_projects" IS NOT NULL
  AND cardinality("hackatime_projects") <> (
    SELECT COUNT(DISTINCT x) FROM unnest("hackatime_projects") x
  );

UPDATE "ships"
SET "hackatime_projects" = ARRAY(SELECT DISTINCT unnest("hackatime_projects"))
WHERE "hackatime_projects" IS NOT NULL
  AND cardinality("hackatime_projects") <> (
    SELECT COUNT(DISTINCT x) FROM unnest("hackatime_projects") x
  );
