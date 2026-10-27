-- 0175_drop_owo_uwu.sql
-- owo and uwu (hardware plagiarism / automated review checks) are gone from the codebase.
-- Drops their ships columns, the check-SLA markers that only tracked them, and user_flags,
-- whose every row is an owo double-dip flag. Dependent indexes go with their columns.
--
-- The system actor users rows from 0168 stay: audit_logs.actor_id still references them.
--
-- IF EXISTS guards keep this re-runnable per the project migration contract.

ALTER TABLE "ships" DROP COLUMN IF EXISTS "owo_check_id";
ALTER TABLE "ships" DROP COLUMN IF EXISTS "owo_check_status";
ALTER TABLE "ships" DROP COLUMN IF EXISTS "owo_check_verdict";
ALTER TABLE "ships" DROP COLUMN IF EXISTS "owo_check_dispatched_at";
ALTER TABLE "ships" DROP COLUMN IF EXISTS "owo_check_attempts";
ALTER TABLE "ships" DROP COLUMN IF EXISTS "owo_check_last_attempt_at";

ALTER TABLE "ships" DROP COLUMN IF EXISTS "uwu_check_id";
ALTER TABLE "ships" DROP COLUMN IF EXISTS "uwu_check_status";
ALTER TABLE "ships" DROP COLUMN IF EXISTS "uwu_check_result";
ALTER TABLE "ships" DROP COLUMN IF EXISTS "uwu_auto_actioned_at";
ALTER TABLE "ships" DROP COLUMN IF EXISTS "uwu_check_dispatched_at";
ALTER TABLE "ships" DROP COLUMN IF EXISTS "uwu_check_attempts";
ALTER TABLE "ships" DROP COLUMN IF EXISTS "uwu_check_last_attempt_at";

ALTER TABLE "ships" DROP COLUMN IF EXISTS "checks_unverified_at";
ALTER TABLE "ships" DROP COLUMN IF EXISTS "checks_unverified_reason";

DROP TABLE IF EXISTS "user_flags";

DELETE FROM "app_settings" WHERE "key" = 'auto_uwu_bounce_disabled';
