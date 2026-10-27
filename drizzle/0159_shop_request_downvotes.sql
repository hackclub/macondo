ALTER TABLE "shop_item_requests"
  ADD COLUMN IF NOT EXISTS "downvote_count" integer NOT NULL DEFAULT 0;
--> statement-breakpoint

ALTER TABLE "shop_item_request_votes"
  ADD COLUMN IF NOT EXISTS "direction" varchar(8) NOT NULL DEFAULT 'up';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "shop_item_requests_downvote_count_idx"
  ON "shop_item_requests" ("downvote_count" DESC);
