-- Events + per-attendee RSVP/gift rows for the events dashboard.
--
-- An event_attendees row serves two coexisting roles via disjoint column sets:
-- RSVP (rsvp_status/rsvp_source/rsvp_at/reminder_sent_at) and gift (gift_*).
-- The unique (event_id, user_id) index makes both an upsert. Gift approval
-- writes either a real currency_transactions row (gold) or a free shop_orders
-- row (item), linked back via gift_currency_transaction_id / gift_shop_order_id.
--
-- Re-runnable per the migration contract: guarded CREATE TYPE, CREATE TABLE IF
-- NOT EXISTS, guarded FK constraints, CREATE INDEX IF NOT EXISTS.

DO $$ BEGIN
  CREATE TYPE "event_status" AS ENUM ('draft', 'published', 'completed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "event_gift_kind" AS ENUM ('gold', 'shop_item');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "event_gift_status" AS ENUM ('proposed', 'approved', 'denied');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "event_rsvp_status" AS ENUM ('interested', 'not_interested');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "event_attendee_source" AS ENUM ('self', 'organizer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"location" text,
	"image_url" text,
	"starts_at" timestamp,
	"ends_at" timestamp,
	"timezone" varchar,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"created_by" text NOT NULL,
	"announced_at" timestamp,
	"announcement_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "event_attendees" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"is_winner" boolean DEFAULT false NOT NULL,
	"added_by" text,
	"rsvp_status" "event_rsvp_status",
	"rsvp_source" "event_attendee_source" DEFAULT 'organizer' NOT NULL,
	"rsvp_at" timestamp,
	"reminder_sent_at" timestamp,
	"gift_kind" "event_gift_kind",
	"gift_gold_amount" integer,
	"gift_shop_item_id" integer,
	"gift_status" "event_gift_status",
	"gift_notes" text,
	"gift_proposed_by" text,
	"gift_proposed_at" timestamp,
	"gift_decided_by" text,
	"gift_decided_at" timestamp,
	"gift_decision_reason" text,
	"gift_shop_order_id" integer,
	"gift_currency_transaction_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "events"
    ADD CONSTRAINT "events_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "events"
    ADD CONSTRAINT "events_announcement_id_announcements_id_fk"
    FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "event_attendees"
    ADD CONSTRAINT "event_attendees_event_id_events_id_fk"
    FOREIGN KEY ("event_id") REFERENCES "events"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "event_attendees"
    ADD CONSTRAINT "event_attendees_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "event_attendees"
    ADD CONSTRAINT "event_attendees_added_by_users_id_fk"
    FOREIGN KEY ("added_by") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "event_attendees"
    ADD CONSTRAINT "event_attendees_gift_shop_item_id_shop_items_id_fk"
    FOREIGN KEY ("gift_shop_item_id") REFERENCES "shop_items"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "event_attendees"
    ADD CONSTRAINT "event_attendees_gift_proposed_by_users_id_fk"
    FOREIGN KEY ("gift_proposed_by") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "event_attendees"
    ADD CONSTRAINT "event_attendees_gift_decided_by_users_id_fk"
    FOREIGN KEY ("gift_decided_by") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "event_attendees"
    ADD CONSTRAINT "event_attendees_gift_shop_order_id_shop_orders_id_fk"
    FOREIGN KEY ("gift_shop_order_id") REFERENCES "shop_orders"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "event_attendees"
    ADD CONSTRAINT "event_attendees_gift_currency_transaction_id_currency_transactions_id_fk"
    FOREIGN KEY ("gift_currency_transaction_id") REFERENCES "currency_transactions"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "events_status_starts_idx" ON "events" ("status", "starts_at");
CREATE UNIQUE INDEX IF NOT EXISTS "event_attendees_event_user_unique" ON "event_attendees" ("event_id", "user_id");
CREATE INDEX IF NOT EXISTS "event_attendees_user_idx" ON "event_attendees" ("user_id");
CREATE INDEX IF NOT EXISTS "event_attendees_gift_status_idx" ON "event_attendees" ("gift_status");
CREATE INDEX IF NOT EXISTS "event_attendees_event_interested_idx" ON "event_attendees" ("event_id", "rsvp_status");
