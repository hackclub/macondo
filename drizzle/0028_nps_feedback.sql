-- NPS feedback widget.
-- Adds:
--   currency_transaction_source += 'nps_feedback'
--   nps_responses     one row per submission, 10 gold awarded per row
--   nps_insights      daily AI summary over the past week of NPS + tickets

ALTER TYPE "public"."currency_transaction_source" ADD VALUE IF NOT EXISTS 'nps_feedback';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "nps_responses" (
    "id" serial PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL,
    "score" integer NOT NULL,
    "doing_well" text NOT NULL,
    "can_improve" text NOT NULL,
    "anything_else" text,
    "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "nps_responses"
      ADD CONSTRAINT "nps_responses_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "nps_responses_user_created_idx" ON "nps_responses" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "nps_responses_created_idx" ON "nps_responses" USING btree ("created_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "nps_insights" (
    "id" serial PRIMARY KEY NOT NULL,
    "generated_for_date" varchar(10) NOT NULL,
    "window_start" timestamp NOT NULL,
    "window_end" timestamp NOT NULL,
    "response_count" integer NOT NULL,
    "ticket_count" integer DEFAULT 0 NOT NULL,
    "nps_score" numeric(6, 2),
    "improvements" text[] NOT NULL,
    "concerns" text[] NOT NULL,
    "positives" text[] NOT NULL,
    "raw_ai_response" text,
    "model" text,
    "created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "nps_insights"
      ADD CONSTRAINT "nps_insights_generated_for_date_unique"
      UNIQUE ("generated_for_date");
EXCEPTION
    WHEN duplicate_object THEN null;
    WHEN duplicate_table THEN null;
END $$;
