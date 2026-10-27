-- ARI external-review mirror state on ships. Populated by the shadow-push in
-- server/api/projects/[id]/ship.post.ts when the ari_enabled app_setting is on,
-- by scripts/backfill-ari-open-queue.ts, and by the inbound decision webhook at
-- /api/webhooks/ari. All nullable: a null ari_status means the ship was
-- never pushed to ARI. Re-runnable via ADD COLUMN IF NOT EXISTS per the
-- project's migration contract.
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "ari_submission_id" text;
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "ari_status" text;
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "ari_synced_at" timestamptz;
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "ari_last_event" jsonb;
