-- Plausible-style pageview analytics. One row per pageview, written by the
-- client beacon on every route change (including in-app SPA navigations that the
-- server-side referral-capture middleware never sees). Sessions, bounce rate,
-- visit duration and entry/exit pages are derived in SQL at read time from a
-- 30-minute inactivity gap, so this stays a single append-only events table with
-- no maintained sessions table.
--
-- Re-runnable on prod: IF NOT EXISTS on the table and every index, and the FK is
-- added inside a duplicate_object guard (see CLAUDE.md: every migration must be
-- idempotent).

CREATE TABLE IF NOT EXISTS "analytics_pageviews" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"visitor_id" text NOT NULL,
	"user_id" text,
	"pathname" text NOT NULL,
	"referrer_host" text,
	"source" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_term" text,
	"utm_content" text,
	"country" varchar(2),
	"browser" text,
	"os" text,
	"device_type" text,
	"screen_size" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "analytics_pageviews" ADD CONSTRAINT "analytics_pageviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_pageviews_created_at_idx" ON "analytics_pageviews" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_pageviews_visitor_created_idx" ON "analytics_pageviews" USING btree ("visitor_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_pageviews_pathname_idx" ON "analytics_pageviews" USING btree ("pathname");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_pageviews_source_idx" ON "analytics_pageviews" USING btree ("source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_pageviews_country_idx" ON "analytics_pageviews" USING btree ("country");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_pageviews_browser_idx" ON "analytics_pageviews" USING btree ("browser");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_pageviews_os_idx" ON "analytics_pageviews" USING btree ("os");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_pageviews_utm_source_idx" ON "analytics_pageviews" USING btree ("utm_source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_pageviews_utm_campaign_idx" ON "analytics_pageviews" USING btree ("utm_campaign");
