-- user_flags: lightweight, non-destructive moderation marker on a user.
-- Distinct from shadow_bans (which hides content sitewide); a flag is a
-- visible signal surfaced in the internal review surface and on the user
-- profile. First use is flag_type='double_dip', written when an owo hardware
-- verdict resolves to a high-confidence double-dip (auto for HIGH severity,
-- one-click reviewer action for MEDIUM).
--
-- Foreign keys are declared inline so the whole table is created (with its
-- constraints) under a single CREATE TABLE IF NOT EXISTS guard, keeping the
-- migration re-runnable on prod state per the "Migrations must apply to prod"
-- rule. Postgres has no ADD CONSTRAINT IF NOT EXISTS, so inline is the
-- re-runnable form.

CREATE TABLE IF NOT EXISTS "user_flags" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users" ("id"),
  "flag_type" text NOT NULL,
  "severity" text NOT NULL,
  "reason" text NOT NULL,
  "ship_id" integer REFERENCES "ships" ("id"),
  "owo_check_id" uuid,
  "source" text NOT NULL,
  "metadata" jsonb,
  "created_by_user_id" text REFERENCES "users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "resolved_at" timestamp,
  "resolved_by_user_id" text REFERENCES "users" ("id"),
  "resolution_note" text
);
--> statement-breakpoint
-- At most one ACTIVE (unresolved) flag per (ship, type): makes owo auto-flagging
-- idempotent across re-polls/backfills while still allowing a fresh flag after
-- an earlier one is resolved (e.g. on resubmit). Partial so reviewer flags with
-- a null ship_id never collide.
CREATE UNIQUE INDEX IF NOT EXISTS "user_flags_active_ship_type_unique"
  ON "user_flags" ("ship_id", "flag_type")
  WHERE "resolved_at" IS NULL AND "ship_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_flags_user_idx"
  ON "user_flags" ("user_id");
