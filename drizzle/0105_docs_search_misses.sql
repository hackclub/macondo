-- Append-only log of docs search queries that returned zero results.
-- The client (docs Cmd+K modal) POSTs to /api/docs/search-miss whenever a
-- query settles on an empty result set; the endpoint dedupes per session
-- before writing. The FAQ admin team uses /internal/docs-misses to spot
-- gaps in the docs and synonym map, dismissing rows once the gap is
-- closed.
--
-- Re-runnable: every CREATE/ALTER guarded with IF NOT EXISTS or DO blocks.

CREATE TABLE IF NOT EXISTS "docs_search_misses" (
  "id" serial PRIMARY KEY NOT NULL,
  "query" text NOT NULL,
  "locale" varchar(2) NOT NULL,
  "user_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "dismissed_at" timestamp,
  "dismissed_by_user_id" text
);

DO $$ BEGIN
  ALTER TABLE "docs_search_misses"
    ADD CONSTRAINT "docs_search_misses_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "docs_search_misses"
    ADD CONSTRAINT "docs_search_misses_dismissed_by_user_id_users_id_fk"
    FOREIGN KEY ("dismissed_by_user_id") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "docs_search_misses_created_idx"
  ON "docs_search_misses" ("created_at");
CREATE INDEX IF NOT EXISTS "docs_search_misses_query_idx"
  ON "docs_search_misses" ("query");
CREATE INDEX IF NOT EXISTS "docs_search_misses_locale_idx"
  ON "docs_search_misses" ("locale");
