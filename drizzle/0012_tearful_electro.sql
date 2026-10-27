CREATE TABLE "hackatime_sync_audits" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"total_hours" integer NOT NULL,
	"delta_hours" integer DEFAULT 0 NOT NULL,
	"sync_date" varchar(10) NOT NULL,
	"extended_streak" boolean DEFAULT false NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "project_streak_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "last_worked_date" varchar(10);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "current_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "longest_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_streak_date" varchar(10);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "streak_freezes_remaining" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_hackatime_total_hours" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_hackatime_synced_at" timestamp;--> statement-breakpoint
ALTER TABLE "hackatime_sync_audits" ADD CONSTRAINT "hackatime_sync_audits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hackatime_sync_audits_user_date_idx" ON "hackatime_sync_audits" ("user_id", "sync_date" DESC);--> statement-breakpoint
CREATE INDEX "hackatime_sync_audits_user_created_idx" ON "hackatime_sync_audits" ("user_id", "created_at" DESC);