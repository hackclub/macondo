-- Landing page CTA click tracking. Pageviews to /minecraft (and any other
-- public landing) are already captured by referral-capture middleware in
-- referral_visits; this table captures the explicit CTA click-through that
-- pageviews can't see. Joined back to referral_visits on visitor_cookie to
-- reconstruct funnels like "search source -> /minecraft -> /docs/minecraft-modding".

CREATE TABLE IF NOT EXISTS "landing_page_clicks" (
  "id" serial PRIMARY KEY NOT NULL,
  "visitor_cookie" text,
  "user_id" text,
  "landing" text NOT NULL,
  "target" text NOT NULL,
  "locale" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "landing_page_clicks"
    ADD CONSTRAINT "landing_page_clicks_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "landing_page_clicks_created_at_idx"
  ON "landing_page_clicks" ("created_at");
CREATE INDEX IF NOT EXISTS "landing_page_clicks_landing_idx"
  ON "landing_page_clicks" ("landing");
CREATE INDEX IF NOT EXISTS "landing_page_clicks_visitor_cookie_idx"
  ON "landing_page_clicks" ("visitor_cookie");
