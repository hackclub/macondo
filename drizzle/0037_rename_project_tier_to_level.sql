-- Rename the projects.tier column to projects.level.
--
-- Values are preserved as-is: projects that stored tier="1" (internally
-- the Beginner/easiest complexity) now have level="1", and projects that
-- stored tier="4" (Expert/hardest) now have level="4". The public UI used
-- to invert the display ("Tier 1 = Expert"); that inversion is being
-- removed at the same time, so the raw stored number now matches what
-- the user sees: level 1 = easiest, level 4 = hardest.

ALTER TABLE "projects" RENAME COLUMN "tier" TO "level";
