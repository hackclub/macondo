-- One post-deadline grace submission per user. After a user's ship deadline
-- passes (server/lib/ship-deadline.ts) they may submit exactly once more --
-- a fresh ship or a needs_changes resubmit, on any of their projects. This
-- column records when that single grace submission was spent; null means it
-- is still available. Stamped by ship.post.ts only after the ship row is
-- actually written, so a submit that failed validation doesn't burn it.
--
-- Re-runnable on prod: ADD COLUMN IF NOT EXISTS makes a second run a no-op,
-- the column is nullable so existing rows don't need a default.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "post_deadline_ship_used_at" timestamp;
