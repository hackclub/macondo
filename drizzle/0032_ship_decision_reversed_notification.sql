-- Adds a new notification_type enum value fired when a reviewer undoes a
-- prior rejection / needs-changes decision on a ship. The user had already
-- received a "rejected" / "needs changes" notification; this one tells them
-- the earlier decision was reversed and their ship is back in the queue.
--
-- IF NOT EXISTS makes this safe to re-run.

ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'ship_decision_reversed';
