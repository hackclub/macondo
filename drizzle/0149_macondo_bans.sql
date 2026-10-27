-- macondo_bans: a HARD account ban, distinct from shadow_bans (which only hides
-- a user's content). An active ban blocks all app access (/api/auth/me throws a
-- 401 banned response and the client bounces the user to /banned) AND removes
-- them from the main Macondo Slack channel via the review ("tung tung sahur")
-- bot, re-kicking on every rejoin. A temp ban carries expires_at (NULL =
-- permanent); the active check compares it against now() so temp bans
-- self-expire with no cron. Bans are never deleted (audit trail); lifting one
-- sets active = false and stamps lifted_at / lifted_by_user_id.
--
-- Foreign keys are declared inline so the whole table is created (with its
-- constraints) under a single CREATE TABLE IF NOT EXISTS guard, keeping the
-- migration re-runnable on prod state per the "Migrations must apply to prod"
-- rule. Postgres has no ADD CONSTRAINT IF NOT EXISTS, so inline is the
-- re-runnable form.

CREATE TABLE IF NOT EXISTS "macondo_bans" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "users" ("id"),
  "reason" text NOT NULL,
  "expires_at" timestamp,
  "created_by_user_id" text NOT NULL REFERENCES "users" ("id"),
  "created_at" timestamp DEFAULT now(),
  "active" boolean DEFAULT true NOT NULL,
  "lifted_at" timestamp,
  "lifted_by_user_id" text REFERENCES "users" ("id")
);
--> statement-breakpoint
-- Per-user active-ban lookup runs on every /api/auth/me and every Slack
-- rejoin, so the (user_id, active) composite keeps it an index probe instead
-- of a seq scan. user_id leads because it has far higher cardinality.
CREATE INDEX IF NOT EXISTS "macondo_bans_user_id_active_idx"
  ON "macondo_bans" ("user_id", "active");
