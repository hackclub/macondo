-- Adds the announcements table. One row per supaadmin broadcast is the
-- canonical record: the authored English title/body plus the auto-translated
-- Spanish, the author, and the recipient count. It backs the ops history list
-- and the audit trail. The user-facing delivery is a fan-out of per-user
-- notifications rows (type 'admin_announcement') created at broadcast time, so
-- this row is never read on the hot dashboard path and editing it would not
-- rewrite already-sent copies. title_es / body_es are nullable so a broadcast
-- still succeeds when the translator is unavailable.
--
-- IF NOT EXISTS / DO $$ BEGIN ... EXCEPTION wrappers make this re-runnable
-- on prod state per the "Migrations must apply to prod" rule.

CREATE TABLE IF NOT EXISTS "announcements" (
  "id" serial PRIMARY KEY NOT NULL,
  "title_en" text NOT NULL,
  "body_en" text NOT NULL,
  "title_es" text,
  "body_es" text,
  "created_by" text NOT NULL,
  "recipient_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "announcements"
    ADD CONSTRAINT "announcements_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
