-- Subsequent-grant fix-path workflow. When a hardware project's update
-- ship is submitted with needs_funding=true AND that project already has
-- a queued/sent grant on a previous ship, the docs require the student
-- to provide a failure journal, photos of the broken build, the parts
-- being replaced, and an updated BOM. These columns let the submit path
-- stamp the ship as a subsequent grant request (so the cart panel can
-- show the fix-path checklist) and snapshot the previous grant amount
-- (so the reviewer can see old-vs-new without an extra query).
--
-- Both columns are default-safe so existing rows are unaffected:
-- is_subsequent_grant_request defaults to false (matches historical
-- behavior where every funded ship was a "first" grant), and
-- previous_grant_amount_cents stays NULL.
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "is_subsequent_grant_request" boolean NOT NULL DEFAULT false;
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "previous_grant_amount_cents" integer;
