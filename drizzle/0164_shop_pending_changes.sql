-- Queue of shop item changes awaiting the bulk Slack announcement. Admin
-- mutations insert before/after snapshots here instead of posting to Slack
-- directly; "Publish changes" on /internal/shop merges rows per item, posts
-- one carousel message, and deletes the published rows. No FK to shop_items
-- so delete changes survive the row they describe.
CREATE TABLE IF NOT EXISTS "shop_pending_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_id" integer NOT NULL,
	"action" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
