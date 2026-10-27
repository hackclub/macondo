-- 0104_streak_day_status_review_protected.sql
-- Add a new value to the streak_day_status enum: 'review_protected'.
-- The reconcile cron writes this status when a gap day overlaps an
-- active review-loop ship, so the user's streak is held without spending
-- a freeze. Without this value the cron silently consumed freezes for
-- days while a ship sat in the queue, contradicting the
-- "Streak protected while in review" copy shown to the student.
--
-- IF NOT EXISTS guards make this re-runnable on prod state per the
-- project rule that every drizzle migration must be re-runnable.
-- Postgres 9.6+ supports ADD VALUE IF NOT EXISTS, so re-running this
-- migration after the value already exists is a no-op.

ALTER TYPE "streak_day_status" ADD VALUE IF NOT EXISTS 'review_protected';
