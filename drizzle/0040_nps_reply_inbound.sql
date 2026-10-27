-- Extend nps_response_replies to support inbound user replies (captured
-- via Slack events webhook when the user DMs back) and to thread outbound
-- staff replies in Slack.
--
-- is_inbound           = true for mirror rows of a user's DM reply
-- slack_thread_root_ts = ts of the FIRST outbound reply for this submission;
--                        subsequent outbound sends use it as thread_ts so
--                        the whole conversation stays in one Slack thread.

ALTER TABLE "nps_response_replies"
  ADD COLUMN IF NOT EXISTS "is_inbound" boolean NOT NULL DEFAULT false;

ALTER TABLE "nps_response_replies"
  ADD COLUMN IF NOT EXISTS "slack_thread_root_ts" text;

CREATE INDEX IF NOT EXISTS "nps_response_replies_slack_ts_idx"
  ON "nps_response_replies" ("slack_message_ts");

CREATE INDEX IF NOT EXISTS "nps_response_replies_thread_root_idx"
  ON "nps_response_replies" ("slack_thread_root_ts");
