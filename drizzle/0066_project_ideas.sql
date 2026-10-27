-- "Idea Box" feature. LLM-suggested project ideas tailored to the user's
-- recent Hackatime activity. Users see fresh suggestions on /ideas and can
-- save the ones they like (saved rows surface a "Start Project" button on
-- the page that pre-fills the dashboard create-project modal) or dismiss
-- the rest. Generation is gated by a 24h cooldown computed from the most
-- recent generated_at row per user, plus a short-window guardAiRequest
-- layer in server/lib/ai-guard.ts to absorb double clicks. status moves
-- suggested -> saved | dismissed and back via PATCH /api/ideas/[id].
-- promoted_to_project_id is reserved for a future "this idea grew into
-- this project" linkage; ON DELETE SET NULL keeps the saved idea visible
-- if the resulting project is later deleted.

DO $$ BEGIN
  CREATE TYPE "project_idea_status" AS ENUM ('suggested', 'saved', 'dismissed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "project_idea_kind" AS ENUM ('new_project', 'project_update');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "project_ideas" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "reasoning" text,
  "languages" text[] NOT NULL DEFAULT ARRAY[]::text[],
  "difficulty" varchar(20),
  "kind" "project_idea_kind" NOT NULL DEFAULT 'new_project',
  "existing_project_id" integer,
  "status" "project_idea_status" NOT NULL DEFAULT 'suggested',
  "generated_at" timestamp NOT NULL DEFAULT now(),
  "saved_at" timestamp,
  "dismissed_at" timestamp,
  "promoted_to_project_id" integer,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE "project_ideas"
    ADD CONSTRAINT "project_ideas_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "project_ideas"
    ADD CONSTRAINT "project_ideas_promoted_to_project_id_projects_id_fk"
    FOREIGN KEY ("promoted_to_project_id") REFERENCES "projects"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "project_ideas"
    ADD CONSTRAINT "project_ideas_existing_project_id_projects_id_fk"
    FOREIGN KEY ("existing_project_id") REFERENCES "projects"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "project_ideas_user_status_idx"
  ON "project_ideas" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "project_ideas_user_generated_idx"
  ON "project_ideas" ("user_id", "generated_at");
