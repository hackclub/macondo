-- Provenance for projects imported from Stasis (a sibling Hack Club maker
-- platform being wound into Macondo). stasis_project_id marks a project as
-- ex-Stasis and maps it back to its source project; the partial unique index
-- makes the import idempotent (re-import upserts onto the existing row) and is
-- the agreed hook for the downstream work-product hour-splitting job.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "stasis_project_id" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "stasis_imported_at" timestamp;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_user_stasis_id_unique" ON "projects" ("user_id","stasis_project_id") WHERE "stasis_project_id" IS NOT NULL;
