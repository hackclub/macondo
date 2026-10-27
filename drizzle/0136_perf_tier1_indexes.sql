-- Tier 1.2 performance indexes. Targets the queue/leaderboard/stats
-- hot paths and the explore-page upvote aggregate.
--
-- audit_logs: queue/leaderboard/stats filter on (entity_type, action,
-- created_at) — see server/api/internal/queue/leaderboard.get.ts:50-92,
-- server/api/internal/queue/stats.get.ts:59-69,113-144, and
-- server/lib/auto-approve-guide-ship.ts:256-263. The existing
-- audit_logs_entity_idx covers (entity_type, entity_id, created_at)
-- which doesn't help when entity_id isn't in the WHERE.
CREATE INDEX IF NOT EXISTS "audit_logs_entity_action_idx" ON "audit_logs" ("entity_type","action","created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_actor_action_idx" ON "audit_logs" ("actor_id","action","created_at");

-- ships: /api/internal/shipped filters status IN ('shipped',
-- 'shipped_missing_airtable') and orders by reviewed_at DESC. The
-- standalone status_idx + reviewed_at_idx force a sort. The composite
-- lets the planner do an index-only ordered scan.
CREATE INDEX IF NOT EXISTS "ships_status_reviewed_at_idx" ON "ships" ("status","reviewed_at");

-- shadow_bans: the queue endpoint runs `NOT EXISTS (... active = true)`
-- per outer row, and the users endpoint runs a similar `(SELECT COUNT(*)
-- ... active = true)` subquery per user. Without (user_id, active) the
-- planner seq-scans the table for every queue row.
CREATE INDEX IF NOT EXISTS "shadow_bans_user_id_active_idx" ON "shadow_bans" ("user_id","active");

-- loops_event_logs: append-only; backfill scripts and the admin log
-- both scan by user_email and order by occurred_at. user_id is the FK
-- for the user-level "last seen" dedup that Airtable uses.
CREATE INDEX IF NOT EXISTS "loops_event_logs_user_email_idx" ON "loops_event_logs" ("user_email");
CREATE INDEX IF NOT EXISTS "loops_event_logs_occurred_at_idx" ON "loops_event_logs" ("occurred_at");
CREATE INDEX IF NOT EXISTS "loops_event_logs_user_id_idx" ON "loops_event_logs" ("user_id");
