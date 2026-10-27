-- Adds owo plagiarism-service check columns to the ships table.
-- owo_check_id: the check_id returned by owo's POST /api/checks
-- owo_check_status: one of 'queued' | 'pending' | 'finished' | 'unavailable'
--   default is 'queued' so new rows are immediately in the polling window
-- owo_check_verdict: the OwoVerdict JSONB blob, populated when status='finished'
--
-- These columns sit alongside the existing plagiarism_check / plagiarism_run_at
-- / plagiarism_severity columns, which are KEPT during the bridge period and
-- dropped later in CUTOVER-02 (deferred manual step).
--
-- IF NOT EXISTS guards make every ALTER TABLE re-runnable on prod state per the
-- "Migrations must apply to prod" project rule.

ALTER TABLE "ships"
  ADD COLUMN IF NOT EXISTS "owo_check_id" uuid;

ALTER TABLE "ships"
  ADD COLUMN IF NOT EXISTS "owo_check_status" text DEFAULT 'queued';

ALTER TABLE "ships"
  ADD COLUMN IF NOT EXISTS "owo_check_verdict" jsonb;

CREATE INDEX IF NOT EXISTS "ships_owo_check_status_idx"
  ON "ships" ("owo_check_status");
