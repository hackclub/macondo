-- Streak day re-anchor to UTC + new reminder column.
--
-- Companion to scripts/migrate-streak-utc-anchor.ts which re-keys
-- existing streak_days / daily_project_activity / users.last_active_date
-- / projects.last_worked_date rows after this schema runs. Slack
-- 2026-05-28 (a user / UXXXXXXXXX) was the loophole report that
-- prompted the re-anchor; see server/lib/streak-helpers.ts:streakDayKey
-- for the full rationale.
--
-- Adds users.reminder_hours_before_day_end (the replacement semantic
-- for the legacy preferred_reminder_hour column, which stays for now
-- as read-only data until a later sweep can drop it safely).
--
-- IF NOT EXISTS makes this safe to re-run on prod, matching the project
-- rule that every migration must be idempotent (see CLAUDE.md).

ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "reminder_hours_before_day_end" integer NOT NULL DEFAULT 1;
