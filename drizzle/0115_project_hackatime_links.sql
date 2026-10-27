-- Per-(lynx project, hackatime project name) link history.
--
-- Records WHEN each hackatime project name was last linked to a lynx
-- project, so the streak walk in extendProjectStreaksFromHackatime can
-- gate per-day contribution by linked_at (a name only contributes
-- seconds on day D where streakDayKey(linked_at) <= D).
--
-- First-time links use the lynx project's created_at to preserve the
-- existing "link an old hackatime project, get a streak backfill" UX.
-- Re-adds (a name previously linked then removed and now relinked) use
-- now(), which closes the unlink+relink double-backfill gaming path.
--
-- Soft-deleted on removal (is_active = false) rather than hard-deleted
-- so re-adds can be distinguished from first-time links via the unique
-- (project_id, name) row.
--
-- Replaces the prior PATCH-side "removal nukes project_streak_days to
-- 0" behavior that produced the 29 -> 0 -> 5 streak jump reported by
-- manjumusei when remove+re-adding a hackatime link. The walk is
-- extend-only, so removing a name now just stops it contributing to
-- future days; existing past-day contribution is preserved.
--
-- Re-runnable per the project's migration contract (IF NOT EXISTS,
-- EXCEPTION-swallowed DO blocks, ON CONFLICT for the backfill).

-- 1. project_hackatime_links table ---------------------------------------

CREATE TABLE IF NOT EXISTS "project_hackatime_links" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"hackatime_name" text NOT NULL,
	"linked_at" timestamp NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "project_hackatime_links" ADD CONSTRAINT "project_hackatime_links_project_id_projects_id_fk"
		FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "project_hackatime_links_project_name_uniq"
	ON "project_hackatime_links" USING btree ("project_id", "hackatime_name");--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "project_hackatime_links_project_active_idx"
	ON "project_hackatime_links" USING btree ("project_id")
	WHERE "is_active" = true;--> statement-breakpoint

-- 2. Backfill from existing projects.hackatime_projects ------------------
--
-- One row per (project_id, hackatime_name) for every name currently in
-- projects.hackatime_projects. linked_at = project.created_at is the
-- conservative choice: it matches the pre-migration behavior so no
-- existing project's streak shrinks at deploy time (the gating check
-- streakDayKey(linked_at) <= D is satisfied for any day at or after the
-- lynx project's creation). COALESCE handles the (unlikely) NULL
-- created_at case. ON CONFLICT DO NOTHING makes the backfill itself
-- re-runnable; subsequent PATCH-driven inserts will see existing rows
-- and use the re-add (linked_at = now()) path instead.
INSERT INTO "project_hackatime_links" ("project_id", "hackatime_name", "linked_at", "is_active")
SELECT
	p.id,
	unnest(p.hackatime_projects) AS hackatime_name,
	COALESCE(p.created_at, NOW()) AS linked_at,
	true AS is_active
FROM "projects" p
WHERE p.hackatime_projects IS NOT NULL
	AND array_length(p.hackatime_projects, 1) > 0
ON CONFLICT ("project_id", "hackatime_name") DO NOTHING;
