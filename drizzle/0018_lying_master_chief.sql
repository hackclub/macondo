CREATE TABLE "referral_visits" (
	"id" serial PRIMARY KEY NOT NULL,
	"visitor_cookie" text NOT NULL,
	"user_id" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_term" text,
	"utm_content" text,
	"referer" text,
	"referer_host" text,
	"landing_path" text NOT NULL,
	"user_agent" text,
	"ip_address" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "currency_transactions" ALTER COLUMN "amount" SET DATA TYPE numeric(14, 4);--> statement-breakpoint
ALTER TABLE "currency_transactions" ADD COLUMN "fruit_type" text;--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN "decision_justification_translations" jsonb;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "name_translations" jsonb;--> statement-breakpoint
ALTER TABLE "shop_items" ADD COLUMN "description_translations" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "timezone" varchar DEFAULT 'UTC';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "github_id" integer;--> statement-breakpoint
ALTER TABLE "referral_visits" ADD CONSTRAINT "referral_visits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;