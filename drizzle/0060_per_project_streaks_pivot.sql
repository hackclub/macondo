-- Pivot to per-project streaks. Drop the user-level streak counter and
-- move "did the user work today?" into a derivable signal based on
-- per-project activity. last_active_date replaces last_streak_date as
-- the floor for the daily reconcile gap walk; it tracks the most
-- recent day the user worked on ANY project.

ALTER TABLE "users" ADD COLUMN "last_active_date" varchar(10);

UPDATE "users" u
SET "last_active_date" = (
  SELECT MAX(p."last_worked_date")
  FROM "projects" p
  WHERE p."user_id" = u."id"
);

ALTER TABLE "users" DROP COLUMN "current_streak";
ALTER TABLE "users" DROP COLUMN "longest_streak";
ALTER TABLE "users" DROP COLUMN "last_streak_date";
