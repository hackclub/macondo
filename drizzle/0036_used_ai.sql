-- Self-reported AI usage on projects and ships.
--
-- Mirrors the needs_funding pattern: the project holds the student's current
-- preference (`next_ship_used_ai` + `next_ship_ai_usage_description`), and
-- each ship snapshots that preference at submit time so the history of a
-- project's AI disclosures is preserved even when the preference changes
-- between ships.
--
-- The description is free text, capped at 2000 chars in the API layer. NULL
-- description on the project table when the checkbox is unticked.

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "next_ship_used_ai" boolean NOT NULL DEFAULT false;
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "next_ship_ai_usage_description" text;

ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "used_ai" boolean NOT NULL DEFAULT false;
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "ai_usage_description" text;
