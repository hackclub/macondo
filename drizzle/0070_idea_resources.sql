-- Project ideas now carry a small list of related learning resources
-- (MDN articles, Hack Club workshops, tutorials, reference projects)
-- so a beginner who likes a generated idea has somewhere to start
-- learning how to actually build it. Stored as a jsonb array of
-- { title, url } objects; idea-generation.ts validates incoming items
-- against an https-only URL rule. Existing rows default to empty.

ALTER TABLE "project_ideas"
  ADD COLUMN IF NOT EXISTS "resources" jsonb NOT NULL DEFAULT '[]'::jsonb;
