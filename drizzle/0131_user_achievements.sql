-- Per-user unlocked achievements + the achievement_unlocked notification
-- type. One row per (user, achievement_key); unlock is permanent.
--
-- Re-runnable per the project's migration contract (CREATE TABLE IF NOT
-- EXISTS, guarded FK, ADD VALUE IF NOT EXISTS on the enum).

CREATE TABLE IF NOT EXISTS "user_achievements" (
	"user_id" text NOT NULL,
	"achievement_key" text NOT NULL,
	"unlocked_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_achievements_user_id_achievement_key_pk" PRIMARY KEY("user_id","achievement_key")
);

DO $$ BEGIN
  ALTER TABLE "user_achievements"
    ADD CONSTRAINT "user_achievements_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "user_achievements_user_idx" ON "user_achievements" ("user_id");

ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'achievement_unlocked';
