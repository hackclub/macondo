-- Adds a new notification_type enum value for supaadmin broadcast
-- announcements. A broadcast fans out one notification row per signed-in user
-- (type 'admin_announcement'); the body holds Markdown rendered in the
-- dashboard popup and the notification center.
--
-- Kept isolated in its own migration (matching 0121) so the new enum value is
-- committed before any later migration or runtime code uses it, avoiding the
-- Postgres "unsafe use of new value of enum type" error.
--
-- IF NOT EXISTS makes this safe to re-run on prod, matching the project rule
-- that every migration must be idempotent (see CLAUDE.md).

ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'admin_announcement';
