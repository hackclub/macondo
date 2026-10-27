-- Shop item suggestion voting + AI group tag + show_username.
--
-- Adds:
--   1. shop_item_request_votes (votes table) with unique (request_id, user_id)
--      so each user can toggle one vote per request.
--   2. shop_item_requests.upvote_count — denormalized counter so the public
--      list query skips a per-row JOIN. Maintained in-vote via the same tx
--      that inserts/deletes the vote row.
--   3. shop_item_requests.group_tag — canonical group label ("Keyboards",
--      "Raspberry Pi", "USB-C Cables") assigned by a small/fast AI call at
--      submit time (see server/lib/shop-request-tag.ts). Lets the browse
--      page show "Grouped with N variations" within seconds of submission,
--      before the AI clustering cron refines the semantic near-dupes.
--   4. shop_item_requests.show_username — per-submission opt-in to show the
--      submitter's username + avatar on the public list. Default false
--      (anonymous by default).
--   5. notification_type 'shop_request_upvoted' — fired once per
--      (request, voter) pair on first upvote, suppressed on re-toggle
--      (mirrors project_upvoted's first_upvoted_at rule).
--
-- Re-runnable via IF NOT EXISTS / ADD VALUE IF NOT EXISTS guards per the
-- repo migration convention (CLAUDE.md).

ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'shop_request_upvoted';
--> statement-breakpoint

ALTER TABLE "shop_item_requests"
  ADD COLUMN IF NOT EXISTS "upvote_count"  integer  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "group_tag"     varchar(80),
  ADD COLUMN IF NOT EXISTS "show_username" boolean  NOT NULL DEFAULT false;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "shop_item_requests_group_tag_idx"
  ON "shop_item_requests" ("group_tag")
  WHERE "group_tag" IS NOT NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "shop_item_requests_upvote_count_idx"
  ON "shop_item_requests" ("upvote_count" DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "shop_item_request_votes" (
  "id"              serial    PRIMARY KEY,
  "request_id"      integer   NOT NULL REFERENCES "shop_item_requests"("id") ON DELETE CASCADE,
  "user_id"         text      NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "first_voted_at"  timestamp,
  "created_at"      timestamp NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "shop_item_request_votes_unique"
  ON "shop_item_request_votes" ("request_id", "user_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "shop_item_request_votes_request_idx"
  ON "shop_item_request_votes" ("request_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "shop_item_request_votes_user_idx"
  ON "shop_item_request_votes" ("user_id");