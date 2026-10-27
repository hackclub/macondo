-- Project ideas now carry a software/hardware category so the page can
-- filter by maker discipline and the generator can hand out a roughly
-- even mix of each. Using plain text instead of an enum to keep the
-- option open for future categories (firmware, mixed, etc) without
-- another ALTER TYPE round trip; the LLM helper validates against the
-- known set on the way in. Existing rows default to "software" since
-- the original prompt was software-leaning.

ALTER TABLE "project_ideas"
  ADD COLUMN IF NOT EXISTS "category" varchar(16) NOT NULL DEFAULT 'software';
