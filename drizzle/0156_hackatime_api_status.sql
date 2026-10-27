-- Liveness of the stored Hackatime OAuth token against the authenticated API.
-- 'ok'             token works (or has not been observed failing)
-- 'invalid_token'  Doorkeeper rejected the token (revoked); re-linking fixes it
-- 'api_restricted' token is VALID but Hackatime blocks the user's API access
--                  (api_access_restricted? = red trust level || pending account
--                  deletion); re-linking does NOT help until the ban/deletion
--                  clears upstream
-- Set by the batch sync / dashboard sync when /authenticated/hours fails and a
-- /me classification probe is definitive; cleared on a successful /hours fetch
-- or a fresh re-link. Non-'ok' users are skipped by every hackatime sweep so
-- dead tokens stop hammering the API (the 2026-07-02 401 flood).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hackatime_api_status" text DEFAULT 'ok' NOT NULL;
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "hackatime_api_status_changed_at" timestamp;
