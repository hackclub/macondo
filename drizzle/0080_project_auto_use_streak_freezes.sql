-- Per-project opt-in to automatic streak freezes. When false, a global
-- freeze burn (in reconcileFreezesIfStale) will still consume one freeze
-- for the user, but THIS project's streak resets to 0 on that gap day
-- instead of riding along for free. Default true preserves historical
-- behavior. Ignored when users.auto_use_streak_freezes is false (no
-- freezes burn in that case, so all projects reset together).
ALTER TABLE "projects" ADD COLUMN "auto_use_streak_freezes" boolean NOT NULL DEFAULT true;
