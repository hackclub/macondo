-- Hardware project grant queue feature.
-- Creates the grant_queue_status enum, project_grants table, partial unique
-- index, and the ship/project columns needed to snapshot "this ship wants
-- HCB funding instead of fruit reward" at submit time.
--
-- Written with IF NOT EXISTS guards so it's safe to re-run against a DB
-- that has already had some of the columns hand-applied in a prior session.

-- 1. Fresh enum for grant queue rows.
DO $$ BEGIN
  CREATE TYPE "public"."grant_queue_status" AS ENUM('queued', 'sent', 'cancelled');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- 2. Project preference column — "does the next ship on this project need
--    HCB funding?" Snapshotted onto ship.needs_funding at submit time.
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "next_ship_needs_funding" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- 3. Per-ship snapshot columns.
ALTER TABLE "ships"
  ADD COLUMN IF NOT EXISTS "needs_funding" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ships"
  ADD COLUMN IF NOT EXISTS "needs_funding_amount_cents" integer;--> statement-breakpoint

-- 4. The grant queue table itself.
CREATE TABLE IF NOT EXISTS "project_grants" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL,
  "ship_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "amount_cents" integer NOT NULL,
  "status" "grant_queue_status" DEFAULT 'queued' NOT NULL,
  "hcb_grant_id" text,
  "hcb_response" jsonb,
  "sent_by_user_id" text,
  "sent_at" timestamp,
  "cancelled_by_user_id" text,
  "cancelled_at" timestamp,
  "cancel_reason" text,
  "cancel_fruit_tx_id" integer,
  "reissued_from_id" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

-- 5. Foreign keys.
DO $$ BEGIN
  ALTER TABLE "project_grants" ADD CONSTRAINT "project_grants_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_grants" ADD CONSTRAINT "project_grants_ship_id_ships_id_fk"
    FOREIGN KEY ("ship_id") REFERENCES "public"."ships"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_grants" ADD CONSTRAINT "project_grants_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_grants" ADD CONSTRAINT "project_grants_sent_by_user_id_users_id_fk"
    FOREIGN KEY ("sent_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_grants" ADD CONSTRAINT "project_grants_cancelled_by_user_id_users_id_fk"
    FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "project_grants" ADD CONSTRAINT "project_grants_cancel_fruit_tx_id_currency_transactions_id_fk"
    FOREIGN KEY ("cancel_fruit_tx_id") REFERENCES "public"."currency_transactions"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- 6. Partial unique index so at most one queued OR sent grant exists per ship.
--    Cancelled rows remain as history and don't conflict.
CREATE UNIQUE INDEX IF NOT EXISTS "project_grants_ship_id_active_unique"
  ON "project_grants" USING btree ("ship_id")
  WHERE status IN ('queued','sent');
