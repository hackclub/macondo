-- Defects A, B, C, E: automated-check SLA state and the escalation ledger.
--
-- Idempotent and re-runnable per the project's migration contract. Adds
-- columns and one table; changes no existing row's review state, mints no
-- gold, and never touches status / reviewed_at / override_hours.

-- === Defects A & B: per-check SLA bookkeeping ================================
-- dispatched_at gives every check a deadline to be measured against.
-- attempts + last_attempt_at drive bounded retry with backoff.
-- Backfilling dispatched_at from created_at means ships submitted before this
-- migration also get a deadline instead of sitting queued forever.

ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "owo_check_dispatched_at" timestamptz;
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "owo_check_attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "owo_check_last_attempt_at" timestamptz;

ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "uwu_check_dispatched_at" timestamptz;
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "uwu_check_attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "uwu_check_last_attempt_at" timestamptz;

-- The fail-open marker. Set when a check reaches a terminal state WITHOUT a
-- verdict, so the reviewer sees "automated checks incomplete — manual
-- verification required". This flag is advisory to a human; nothing in the
-- codebase may read it as permission to approve.
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "checks_unverified_at" timestamptz;
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "checks_unverified_reason" text;

-- Backfill dispatch timestamps for rows that predate the columns. Only fills
-- NULLs, so re-running is a no-op.
UPDATE "ships"
   SET "owo_check_dispatched_at" = "created_at"
 WHERE "owo_check_dispatched_at" IS NULL
   AND "owo_check_status" IS NOT NULL;

UPDATE "ships"
   SET "uwu_check_dispatched_at" = "created_at"
 WHERE "uwu_check_dispatched_at" IS NULL
   AND "uwu_check_status" IS NOT NULL;

-- A dispatch that already succeeded or already failed counts as one attempt.
UPDATE "ships"
   SET "owo_check_attempts" = 1
 WHERE "owo_check_attempts" = 0
   AND "owo_check_status" IS NOT NULL;

UPDATE "ships"
   SET "uwu_check_attempts" = 1
 WHERE "uwu_check_attempts" = 0
   AND "uwu_check_status" IS NOT NULL;

-- The sweeper scans for non-terminal checks; these keep that scan cheap.
CREATE INDEX IF NOT EXISTS "ships_owo_check_sweep_idx"
  ON "ships" ("owo_check_status", "owo_check_dispatched_at");
CREATE INDEX IF NOT EXISTS "ships_uwu_check_sweep_idx"
  ON "ships" ("uwu_check_status", "uwu_check_dispatched_at");

-- Aging dashboard: unassigned ships still in review, oldest first.
CREATE INDEX IF NOT EXISTS "ships_unassigned_review_age_idx"
  ON "ships" ("status", "assigned_user_id", "created_at");


-- === Defects C & E: escalation ledger =======================================
-- One row per (ship, UTC day). The UNIQUE constraint is the hard guarantee
-- behind same-day idempotency: the two rows four seconds apart on 2026-08-05
-- become one insert and one conflict. `tier` records which rung of the ladder
-- fired so the ramp is auditable after the fact.

CREATE TABLE IF NOT EXISTS "review_escalations" (
  "id" serial PRIMARY KEY,
  "ship_id" integer NOT NULL REFERENCES "ships" ("id") ON DELETE CASCADE,
  -- '<shipId>:<YYYY-MM-DD>' in UTC, from escalationDayKey().
  "idempotency_key" text NOT NULL,
  "day_key" date NOT NULL,
  "tier" text NOT NULL,
  "days_waiting" integer NOT NULL,
  "slack_channel" text,
  "slack_ts" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "review_escalations_idempotency_key_idx"
  ON "review_escalations" ("idempotency_key");

CREATE INDEX IF NOT EXISTS "review_escalations_ship_idx"
  ON "review_escalations" ("ship_id", "day_key" DESC);
