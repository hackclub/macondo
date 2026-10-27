-- Per-member private notes for a project. Composite primary key on
-- (user_id, project_id) so each member keeps their own note; never shown
-- to others. Backs the "Private notes" card on the project page.
--
-- Re-runnable per the project's migration contract (CREATE TABLE IF NOT
-- EXISTS + guarded FK constraints).

CREATE TABLE IF NOT EXISTS "project_notes" (
	"user_id" text NOT NULL,
	"project_id" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_notes_user_id_project_id_pk" PRIMARY KEY("user_id","project_id")
);

DO $$ BEGIN
  ALTER TABLE "project_notes"
    ADD CONSTRAINT "project_notes_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "project_notes"
    ADD CONSTRAINT "project_notes_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
