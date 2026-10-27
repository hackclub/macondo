-- Adds the cross-repo / cross-submission plagiarism signal columns to the
-- ships table. plagiarism_check holds the JSONB blob produced by
-- server/lib/plagiarism.ts (hardware ships only); plagiarism_run_at marks
-- when it was last computed; plagiarism_severity is the denormalized
-- topSeverity ("info"|"low"|"medium"|"high") used to enforce the
-- supaadmin-only lock on action endpoints without parsing the blob.
--
-- IF NOT EXISTS guards make this re-runnable on prod state per the
-- "Migrations must apply to prod" rule.

ALTER TABLE "ships"
  ADD COLUMN IF NOT EXISTS "plagiarism_check" jsonb;

ALTER TABLE "ships"
  ADD COLUMN IF NOT EXISTS "plagiarism_run_at" timestamp;

ALTER TABLE "ships"
  ADD COLUMN IF NOT EXISTS "plagiarism_severity" text;

CREATE INDEX IF NOT EXISTS "ships_plagiarism_severity_idx"
  ON "ships" ("plagiarism_severity");
