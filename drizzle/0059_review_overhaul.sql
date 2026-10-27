-- Review system overhaul migration:
--
-- 1. Project: per-project "next ship is an update" preference plus the
--    student-provided description of what changed. Mirrors the existing
--    next_ship_needs_funding / next_ship_used_ai snapshot pattern. Always
--    safe to default false / null on existing rows; the implicit
--    "previous shipped ship exists" check still works for legacy ships.
--
-- 2. Ship: snapshot of those project preferences at submit time, plus the
--    cached AI auto-check result and its run timestamp. Background job in
--    server/lib/auto-checks.ts populates the result after submit; reviewers
--    can force a synchronous re-run via /api/internal/ships/[id]/auto-checks.

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "next_ship_is_update" boolean NOT NULL DEFAULT false;

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "next_ship_update_description" text;

ALTER TABLE "ships"
  ADD COLUMN IF NOT EXISTS "is_update" boolean NOT NULL DEFAULT false;

ALTER TABLE "ships"
  ADD COLUMN IF NOT EXISTS "update_description" text;

ALTER TABLE "ships"
  ADD COLUMN IF NOT EXISTS "auto_check_result" jsonb;

ALTER TABLE "ships"
  ADD COLUMN IF NOT EXISTS "auto_check_run_at" timestamp;
