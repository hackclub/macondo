-- Collapse projects.type from text[] (allowed values
-- ["software"], ["hardware"], ["software","hardware"]) down to a single
-- text column ("software" | "hardware"). The hybrid case ["software",
-- "hardware"] is mapped to "hardware" because hardware is the
-- funding-eligible classification: defaulting hybrid rows to hardware
-- preserves grant context and the build-cost / cart-screenshots
-- requirements that come with it. Single-element rows pass through
-- unchanged. Anything unexpected (NULL, empty array, unknown values)
-- falls back to "software" since that's the historical default for
-- new projects (server/api/projects.post.ts).
--
-- Done as add-new-column / backfill / drop-old / rename so we never
-- have a moment where the column exists but a row is unbacked. This
-- pattern also avoids drizzle's default `USING type[1]` cast which
-- would silently drop the "hardware" half of hybrid rows.

ALTER TABLE "projects" ADD COLUMN "type_new" text;

UPDATE "projects"
SET "type_new" = CASE
  WHEN 'hardware' = ANY("type") THEN 'hardware'
  WHEN 'software' = ANY("type") THEN 'software'
  ELSE 'software'
END;

ALTER TABLE "projects" ALTER COLUMN "type_new" SET NOT NULL;

ALTER TABLE "projects" DROP COLUMN "type";
ALTER TABLE "projects" RENAME COLUMN "type_new" TO "type";

ALTER TABLE "projects" ADD CONSTRAINT "projects_type_check" CHECK ("type" IN ('software', 'hardware'));
