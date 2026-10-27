-- Show and Tell notification types, fired by the gold-adjustment endpoint when
-- a supaadmin tags an award as a Show and Tell win or participation.
--
-- IF NOT EXISTS keeps this re-runnable on prod state, matching the project rule
-- that every migration must be idempotent (see CLAUDE.md).

ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'show_and_tell_won';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'show_and_tell_participated';
