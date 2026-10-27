-- Per-ship snapshot of project.project_streak_days at submit time, used by
-- review.post.ts to compute the fruit multiplier as max(snapshot, live) so
-- review-queue latency can't silently drop a student's earned bonus. Continued
-- work during review still lets the live streak win when it's higher.
--
-- Nullable: existing under_review rows pre-date this column; rows that the
-- backfill below leaves at NULL fall back to live-only behavior in
-- effectiveStreakDaysForShip (status quo). Idempotent ALTER for prod re-runs.

ALTER TABLE "ships"
  ADD COLUMN IF NOT EXISTS "project_streak_days_at_submission" integer;

-- Backfill in-queue ships from audit_logs. Reconstructs the streak as it
-- was at the moment of submission by finding the most recent
-- project_streak_extend / project_streak_revert event for the project,
-- bounded above by ship.created_at and below by the user's most recent
-- all_streaks_reset event (so a streak break between the last extend and
-- submission correctly zeroes the snapshot).
--
-- audit_logs payload shape (see server/lib/streaks.ts):
--   project_streak_extend:  entity_type='project', entity_id=String(project_id),
--                           new_value->>'project_streak_days' = post-extend count
--   project_streak_revert:  same shape (journal-archive same-day rollback)
--   all_streaks_reset:      entity_type='user', entity_id=user_id, actor_id=user_id
--
-- Idempotent via the IS NULL guard. Touches reviewable rows only;
-- shipped/rejected ships are handled by a separate read-only analysis script.
WITH last_reset AS (
  SELECT entity_id AS user_id, MAX(created_at) AS reset_at
  FROM audit_logs
  WHERE action = 'all_streaks_reset'
    AND entity_type = 'user'
  GROUP BY entity_id
)
UPDATE ships s
SET project_streak_days_at_submission = COALESCE(
  (
    SELECT (al.new_value ->> 'project_streak_days')::int
    FROM audit_logs al
    LEFT JOIN last_reset lr ON lr.user_id = s.user_id
    WHERE al.entity_type = 'project'
      AND al.entity_id = s.project_id::text
      AND al.action IN ('project_streak_extend', 'project_streak_revert')
      AND al.created_at <= s.created_at
      AND (lr.reset_at IS NULL OR al.created_at > lr.reset_at)
    ORDER BY al.created_at DESC
    LIMIT 1
  ),
  0
)
WHERE s.project_streak_days_at_submission IS NULL
  AND s.status IN ('under_review', 'pending_fraud_review', 'needs_changes');
