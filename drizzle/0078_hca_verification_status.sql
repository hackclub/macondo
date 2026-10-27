-- Cache HCA's verification_status / ysws_eligible on the users row at
-- OAuth callback time so the dashboard banner can answer "is this user
-- verified?" without an extra round-trip to auth.hackclub.com on every
-- page load. Rejected users (ineligible + fatal_rejection=true) are
-- blocked at the callback and never reach a session, so we should never
-- see "ineligible" here for an active user.
ALTER TABLE "users" ADD COLUMN "hca_verification_status" text;
ALTER TABLE "users" ADD COLUMN "hca_ysws_eligible" boolean;
