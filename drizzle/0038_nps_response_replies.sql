-- Staff replies to individual NPS submissions. Each reply is sent as a
-- spoofed Slack DM from the responder's identity (username + icon_url on
-- chat.postMessage), mirroring the support-ticket impersonation pattern.
-- slack_message_ts is populated when delivery succeeds; slack_error holds
-- the Slack API error string when it fails so staff can see why.

CREATE TABLE IF NOT EXISTS "nps_response_replies" (
  "id"                 serial PRIMARY KEY,
  "nps_response_id"    integer NOT NULL REFERENCES "nps_responses"("id") ON DELETE CASCADE,
  "responder_user_id"  text REFERENCES "users"("id") ON DELETE SET NULL,
  "body"               text NOT NULL,
  "slack_message_ts"   text,
  "slack_channel_id"   text,
  "slack_error"        text,
  "created_at"         timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "nps_response_replies_response_idx"
  ON "nps_response_replies" ("nps_response_id");
