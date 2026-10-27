-- Adds a new notification_type enum value for the streak-freeze-used notice.
-- The daily reconcile auto-consumes a streak freeze to bridge a gap day; this
-- notification surfaces that to the maker (one summary per reconcile run, not
-- one per day) so a freeze is never spent silently.
--
-- IF NOT EXISTS makes this safe to re-run on prod, matching the project rule
-- that every migration must be idempotent (see CLAUDE.md).

ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'streak_freeze_used';
