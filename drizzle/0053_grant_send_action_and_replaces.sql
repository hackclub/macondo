-- Two new columns on project_grants for the topup/reissue flow:
--
-- intended_send_action is a pre-computed hint set at ship-approve time so
-- the supaadmin grants page can label the Send button correctly (new
-- card / top up / reissue) without hitting HCB per row. Re-verified and
-- possibly corrected against live HCB state at send time. Allowed values
-- are 'first_card' | 'top_up' | 'reissue'. NULL on legacy rows; the UI
-- treats NULL as 'first_card' so historical display does not change.
--
-- hcb_card_replaces_id is set on send when the new card replaces a
-- cancelled HCB card (the student cancelled their card from HCB's side).
-- Points at the prior cancelled HCB card grant ID. Independent of
-- reissued_from_id, which tracks the internal project_grants row chain.

ALTER TABLE "project_grants" ADD COLUMN "intended_send_action" text;
ALTER TABLE "project_grants" ADD COLUMN "hcb_card_replaces_id" text;

ALTER TABLE "project_grants"
  ADD CONSTRAINT "project_grants_intended_send_action_check"
  CHECK ("intended_send_action" IS NULL OR "intended_send_action" IN ('first_card', 'top_up', 'reissue'));
