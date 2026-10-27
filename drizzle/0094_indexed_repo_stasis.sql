-- Stasis-specific metadata on indexed_repo. Populated only for rows where
-- source = 'stasis' (rows ingested from the Stasis Postgres directly via
-- NUXT_READONLY_STASIS_DATABASE_URL). Other sources leave these columns
-- null.
--
-- The stasis_active flag is denormalized from (designStatus, buildStatus)
-- so the match-build path can branch on it cheaply at plagiarism-check
-- time without parsing the status text. A Stasis project is "active" if
-- EITHER stage is `in_review` or `update_requested`; otherwise it's
-- finalized (`approved`/`rejected`) or a legitimate migration.
--
-- IF NOT EXISTS guards keep this re-runnable on prod state per the
-- "Migrations must apply to prod" project rule.

ALTER TABLE "indexed_repo"
  ADD COLUMN IF NOT EXISTS "stasis_project_id"    text,
  ADD COLUMN IF NOT EXISTS "stasis_design_status" text,
  ADD COLUMN IF NOT EXISTS "stasis_build_status"  text,
  ADD COLUMN IF NOT EXISTS "stasis_active"        boolean;

-- Partial index: fast lookup of "all stasis projects that are still
-- active." Used by the match-builder branch in plagiarism.ts and any
-- future admin dashboard that needs to enumerate active double-dip risks.
CREATE INDEX IF NOT EXISTS "indexed_repo_stasis_active_idx"
  ON "indexed_repo" ("stasis_active")
  WHERE "source" = 'stasis';

-- Lookup by Stasis project id for cron-side dedup. The unique
-- constraint on code_url already prevents duplicate rows-per-repo, but
-- this index makes "is this Stasis project already indexed?" queries
-- and post-cron audits ("did all expected Stasis projects land?") fast.
CREATE INDEX IF NOT EXISTS "indexed_repo_stasis_project_id_idx"
  ON "indexed_repo" ("stasis_project_id")
  WHERE "stasis_project_id" IS NOT NULL;
