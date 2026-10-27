-- 0101_drop_legacy_plagiarism_columns.sql
-- Drop the legacy in-process plagiarism columns from the ships table. The
-- owo_check_id / owo_check_status / owo_check_verdict columns (added by
-- 0099_owo_check_columns) are now the only source of hardware fraud
-- verdicts.
--
-- IF EXISTS guards make this re-runnable on already-cutover state per the
-- project rule that every drizzle migration must be re-runnable on prod.

ALTER TABLE "ships" DROP COLUMN IF EXISTS "plagiarism_check";
ALTER TABLE "ships" DROP COLUMN IF EXISTS "plagiarism_run_at";
ALTER TABLE "ships" DROP COLUMN IF EXISTS "plagiarism_severity";
