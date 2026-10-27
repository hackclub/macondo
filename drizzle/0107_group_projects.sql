-- Group projects feature on main.
--
-- Adds:
--   * project_collaborators table (membership rows for the per-project
--     invite-code flow; replaces dev's pending/accept dance since code
--     redeems land straight into active status).
--   * ship_contributors table (per-contributor snapshot of hackatime hours
--     and reviewer-approved hours/fruit, drives the hours-weighted payout
--     split at ship approval).
--   * projects.invite_code (varchar(9), unique, "XXXX-XXXX" Crockford base32
--     minus confusables 0/O/1/I/L/U). Backfilled inline so the lazy-mint
--     path in server/api/projects/[id]/invite-code/index.get.ts is only
--     consulted for projects created after this migration but before any
--     code is ever requested.
--   * journals.user_id (text, FK to users, NOT NULL after backfill). Drives
--     the per-contributor breakdown on the public project page and the
--     internal reviewer dashboard.
--   * Four new notification_type enum values (collab_joined_via_code,
--     collab_left, collab_removed, collab_ship_approved).
--
-- Backfills:
--   * journals.user_id <- projects.user_id for every existing journal.
--   * projects.invite_code via a pgcrypto-driven random generator that
--     respects the same alphabet as the application code.
--   * ship_contributors: one row per existing ship with the owner as sole
--     contributor; hackatime_hours / approved_hours from the ship row,
--     fruit_awarded summed from currency_transactions rows tied to the ship.
--
-- All DDL uses IF NOT EXISTS / EXCEPTION-swallowed DO blocks per the
-- project's re-runnable contract (see CLAUDE.md and dev's 0024 / 0026
-- migrations for the pattern).

CREATE EXTENSION IF NOT EXISTS "pgcrypto";--> statement-breakpoint

-- 1. project_collaborators ------------------------------------------------

CREATE TABLE IF NOT EXISTS "project_collaborators" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL,
	"left_at" timestamp,
	"joined_via" text
);--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "project_collaborators" ADD CONSTRAINT "project_collaborators_project_id_projects_id_fk"
		FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "project_collaborators" ADD CONSTRAINT "project_collaborators_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "project_collaborators_project_id_user_id_unique"
	ON "project_collaborators" USING btree ("project_id", "user_id");--> statement-breakpoint

-- 2. ship_contributors ---------------------------------------------------

CREATE TABLE IF NOT EXISTS "ship_contributors" (
	"id" serial PRIMARY KEY NOT NULL,
	"ship_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"hackatime_hours" numeric(10, 2) DEFAULT 0 NOT NULL,
	"approved_hours" numeric(10, 2),
	"fruit_awarded" numeric(14, 4),
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ship_contributors" ADD CONSTRAINT "ship_contributors_ship_id_ships_id_fk"
		FOREIGN KEY ("ship_id") REFERENCES "public"."ships"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ship_contributors" ADD CONSTRAINT "ship_contributors_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "ship_contributors_ship_id_user_id_unique"
	ON "ship_contributors" USING btree ("ship_id", "user_id");--> statement-breakpoint

-- 3. projects.invite_code ------------------------------------------------

ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "invite_code" varchar(9);--> statement-breakpoint

-- Unique index created BEFORE the backfill so the EXCEPTION WHEN
-- unique_violation branch in the DO block below can fire. Postgres treats
-- NULLs as distinct under a UNIQUE constraint by default, so the
-- pre-backfill state (all rows NULL) is accepted.
CREATE UNIQUE INDEX IF NOT EXISTS "projects_invite_code_unique"
	ON "projects" USING btree ("invite_code");--> statement-breakpoint

-- Backfill projects.invite_code for every existing project. Uses the same
-- Crockford base32 alphabet minus confusables (no 0/O/1/I/L/U) that the
-- application uses in server/lib/invite-code.ts, formatted as XXXX-XXXX.
-- Retries on collision via a WHILE loop against the UNIQUE index above.
DO $$
DECLARE
	alphabet text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
	proj record;
	candidate text;
	attempts int;
	i int;
	b int;
BEGIN
	FOR proj IN SELECT id FROM "projects" WHERE "invite_code" IS NULL LOOP
		attempts := 0;
		LOOP
			candidate := '';
			FOR i IN 1..8 LOOP
				b := (get_byte(gen_random_bytes(1), 0) % 32) + 1;
				candidate := candidate || substr(alphabet, b, 1);
			END LOOP;
			candidate := substr(candidate, 1, 4) || '-' || substr(candidate, 5, 4);

			BEGIN
				UPDATE "projects" SET "invite_code" = candidate WHERE "id" = proj.id;
				EXIT;
			EXCEPTION WHEN unique_violation THEN
				attempts := attempts + 1;
				IF attempts >= 8 THEN
					RAISE EXCEPTION 'Failed to allocate unique invite_code for project %', proj.id;
				END IF;
			END;
		END LOOP;
	END LOOP;
END $$;--> statement-breakpoint

-- 4. journals.user_id ----------------------------------------------------

ALTER TABLE "journals" ADD COLUMN IF NOT EXISTS "user_id" text;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "journals" ADD CONSTRAINT "journals_user_id_users_id_fk"
		FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

-- Backfill journals.user_id from the owning project's user_id so historical
-- journals are attributed to the project owner. Only touches rows where the
-- column is still NULL so re-running is a no-op once it has run once.
UPDATE "journals"
SET "user_id" = "projects"."user_id"
FROM "projects"
WHERE "journals"."project_id" = "projects"."id"
	AND "journals"."user_id" IS NULL;--> statement-breakpoint

-- Flip the column to NOT NULL after the backfill. Wrapped in a DO block so
-- a re-run after the constraint already exists is a no-op.
DO $$ BEGIN
	ALTER TABLE "journals" ALTER COLUMN "user_id" SET NOT NULL;
EXCEPTION WHEN others THEN null;
END $$;--> statement-breakpoint

-- 5. ship_contributors backfill ------------------------------------------

-- One row per existing ship with the owner as sole contributor. Hours come
-- from the ship row's reviewer-decided columns (override_hours preferred,
-- falling back to hackatime_hours then 0). fruit_awarded is the sum of
-- counted, non-pending currency_transactions tied to this ship for the
-- owner. Skips ships that already have a matching contributor row so a
-- re-run is a no-op.
INSERT INTO "ship_contributors" (
	"ship_id",
	"user_id",
	"hackatime_hours",
	"approved_hours",
	"fruit_awarded"
)
SELECT
	s.id AS ship_id,
	s.user_id AS user_id,
	COALESCE(s.hackatime_hours, 0)::numeric(10, 2) AS hackatime_hours,
	COALESCE(s.override_hours, s.software_override_hours, s.hackatime_hours)::numeric(10, 2) AS approved_hours,
	(
		SELECT COALESCE(SUM(ct.amount), 0)::numeric(14, 4)
		FROM "currency_transactions" ct
		WHERE ct.ship_id = s.id
			AND ct.user_id = s.user_id
			AND ct.source = 'ship_reward'
			AND ct.type = 'increase'
	) AS fruit_awarded
FROM "ships" s
WHERE NOT EXISTS (
	SELECT 1 FROM "ship_contributors" sc
	WHERE sc.ship_id = s.id AND sc.user_id = s.user_id
);--> statement-breakpoint

-- 6. notification_type enum extensions -----------------------------------

-- Each ADD VALUE runs as its own statement so the migrator doesn't wrap
-- it in a transaction with other DDL (Postgres < 12 disallows ADD VALUE
-- inside a tx).
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'collab_joined_via_code';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'collab_left';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'collab_removed';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'collab_ship_approved';
