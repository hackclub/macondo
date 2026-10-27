-- Ship review integration with the external uwu.hackclub.com job API.
-- Mirrors the existing owo_check_* trio with one additional column,
-- uwu_auto_actioned_at, that prevents the fallback poller from re-bouncing
-- the same ship to the user across subsequent polls.
--
-- Runs on BOTH hardware and software ships (owo runs on hardware only).
-- See server/api/projects/[id]/ship.post.ts for dispatch and
-- server/lib/uwu-verdict-cache.ts for the auto-bounce path.
--
-- IF NOT EXISTS makes this safe to re-run on prod, matching the project
-- rule that every migration must be idempotent (see CLAUDE.md).

ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "uwu_check_id" uuid;
--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "uwu_check_status" text;
--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "uwu_check_result" jsonb;
--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "uwu_auto_actioned_at" timestamp with time zone;
