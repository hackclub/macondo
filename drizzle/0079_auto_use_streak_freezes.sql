-- Per-user opt-out for auto-burning streak freezes. Default true keeps the
-- existing behavior: when the daily reconcile finds a gap day, it consumes
-- one freeze. Setting this to false makes the reconcile skip the freeze
-- branch and reset every project streak on the first missed day.
ALTER TABLE "users" ADD COLUMN "auto_use_streak_freezes" boolean NOT NULL DEFAULT true;
