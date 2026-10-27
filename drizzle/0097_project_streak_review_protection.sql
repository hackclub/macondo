-- Per-ship snapshot of project.last_worked_date at submit time, paired with
-- project_streak_days_at_submission from migration 0084. The reconcile cron
-- in server/lib/streaks.ts now skips per-project resets for projects with an
-- active ship in a review state, and this column is the recovery anchor for
-- the one-shot scripts/backfill-streak-under-review.ts that restores users
-- whose streaks were wiped before the protection landed.
--
-- Nullable: legacy rows pre-date this column; backfill below reconstructs
-- the value from audit_logs where possible and falls back to NULL otherwise
-- (the runtime treats NULL as "use ship.created_at::date" during recovery).
-- Idempotent ALTER for prod re-runs.

ALTER TABLE "ships"
  ADD COLUMN IF NOT EXISTS "project_last_worked_date_at_submission" varchar(10);

-- Backfill in-queue ships from audit_logs. Mirrors the logic used in
-- migration 0084 for project_streak_days_at_submission: pick the most
-- recent project_streak_extend / project_streak_revert event for the
-- project, bounded by ship.created_at and the user's most recent
-- all_streaks_reset, then read last_worked_date out of the audit payload.
WITH last_reset AS (
  SELECT entity_id AS user_id, MAX(created_at) AS reset_at
  FROM audit_logs
  WHERE action = 'all_streaks_reset'
    AND entity_type = 'user'
  GROUP BY entity_id
)
UPDATE ships s
SET project_last_worked_date_at_submission = (
  SELECT (al.new_value ->> 'last_worked_date')
  FROM audit_logs al
  LEFT JOIN last_reset lr ON lr.user_id = s.user_id
  WHERE al.entity_type = 'project'
    AND al.entity_id = s.project_id::text
    AND al.action IN ('project_streak_extend', 'project_streak_revert')
    AND al.created_at <= s.created_at
    AND (lr.reset_at IS NULL OR al.created_at > lr.reset_at)
  ORDER BY al.created_at DESC
  LIMIT 1
)
WHERE s.project_last_worked_date_at_submission IS NULL
  AND s.status IN ('under_review', 'pending_fraud_review', 'needs_changes');
