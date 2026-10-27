-- Adds the project_upvotes table (one row per (project, viewer) pair) plus a
-- new notification_type enum value fired the first time a viewer upvotes a
-- given project. Subsequent un-upvote / re-upvote cycles do not re-notify
-- because first_upvoted_at is set on the first insert and only re-stamped
-- when it is still null on a later re-insert (see upvote.post.ts).
--
-- IF NOT EXISTS / DO $$ BEGIN ... EXCEPTION wrappers make this re-runnable
-- on prod state per the "Migrations must apply to prod" rule.

ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'project_upvoted';

CREATE TABLE IF NOT EXISTS "project_upvotes" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "first_upvoted_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "project_upvotes"
    ADD CONSTRAINT "project_upvotes_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "project_upvotes"
    ADD CONSTRAINT "project_upvotes_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "project_upvotes_unique"
  ON "project_upvotes" ("project_id", "user_id");

CREATE INDEX IF NOT EXISTS "project_upvotes_project_idx"
  ON "project_upvotes" ("project_id");

CREATE INDEX IF NOT EXISTS "project_upvotes_user_idx"
  ON "project_upvotes" ("user_id");
