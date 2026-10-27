-- Remove any project_upvotes rows where the underlying project does not yet
-- have a shipped (or shipped_missing_airtable) ship. This is a one-time
-- cleanup of historical abuse: unshipped projects were being upvoted before
-- /api/projects/[id]/upvote enforced the new ship-required gate, which
-- distorted explore counts and the leaderboard.
--
-- Naturally idempotent under the "migrations must apply to prod" rule:
-- once the abusive rows are gone and the API gate is live, re-running this
-- migration matches zero rows and is a no-op.
--
-- Notifications (type 'project_upvoted') are intentionally left alone. They
-- act as a permanent ledger and the dedupe path in upvote.post.ts is keyed
-- on "<project_id>:<user_id>", so even if a project later ships and the
-- same viewer re-upvotes, no duplicate notification will fire.

DELETE FROM "project_upvotes" pu
WHERE NOT EXISTS (
  SELECT 1 FROM "ships" s
  WHERE s.project_id = pu.project_id
    AND s.status IN ('shipped', 'shipped_missing_airtable')
);
