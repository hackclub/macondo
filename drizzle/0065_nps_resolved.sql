-- Mark-as-resolved support for NPS submissions. Lets staff close out a
-- thread that doesn't actually need a reply (e.g. user said "thanks!"), so
-- the /internal/nps "Needs reply" badge stops surfacing it. Mirrors the
-- support-ticket resolve fields without the status enum since open/resolved
-- is the only state we need.

ALTER TABLE "nps_responses"
  ADD COLUMN IF NOT EXISTS "resolved_at" timestamp;

ALTER TABLE "nps_responses"
  ADD COLUMN IF NOT EXISTS "resolved_by_user_id" text REFERENCES "users"("id") ON DELETE SET NULL;
