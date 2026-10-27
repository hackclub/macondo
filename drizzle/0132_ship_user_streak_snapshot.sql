-- Per-ship snapshot of the OWNER's headline streak (getUserCurrentStreak, the
-- streak_days run) captured at submit time. Floors the DISPLAYED headline
-- streak while the ship sits in an open review window (reviewed_at null), so a
-- streak that would otherwise break mid-review falls back to the queue-entry
-- value. Nullable; null means no floor (legacy rows + ships already in review
-- when this column shipped). Re-runnable on prod via IF NOT EXISTS.
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "user_streak_at_submission" integer;
