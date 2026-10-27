-- Postgres-backed plagiarism index. See docs/superpowers/specs/2026-05-07-plagiarism-index-design.md.
--
-- indexed_repo holds one row per fingerprinted repo (either a unified-DB
-- submission resolved through archive.hackclub.com, or a YSWS-user public
-- GitHub repo crawled to fill out Stage 1 same-author coverage).
-- indexed_file holds one row per non-vendored, non-org-folder, non-dotfile
-- blob inside those repos so we can answer "who else has blob SHA X" with
-- one indexed lookup. Dotfiles (.gitkeep, .gitignore, etc.) all have
-- identical SHAs across repos and are filtered at write time. JSONB
-- columns hold the (already-deserialized) KiCad project fingerprint and
-- the (post-hoc-serializable) text fingerprint.
--
-- IF NOT EXISTS guards keep this re-runnable on prod state per the
-- "Migrations must apply to prod" project rule.

CREATE TABLE IF NOT EXISTS "indexed_repo" (
  "id"                       serial PRIMARY KEY,
  "source"                   text NOT NULL,
  "code_url"                 text NOT NULL,
  "owner"                    text NOT NULL,
  "repo"                     text NOT NULL,
  "default_branch"           text,
  "ysws_name"                text,
  "airtable_record_id"       text,
  "approved_at"              timestamp,
  "indexed_at"               timestamp NOT NULL DEFAULT now(),
  "index_attempt_at"         timestamp NOT NULL DEFAULT now(),
  "failed_reason"            text,
  "blob_count"               integer NOT NULL DEFAULT 0,
  "kicad_fingerprint"        jsonb,
  "text_fingerprint"         jsonb,
  "contributor_usernames"    text[] NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS "indexed_repo_code_url_uniq" ON "indexed_repo" ("code_url");
CREATE INDEX IF NOT EXISTS "indexed_repo_owner_idx" ON "indexed_repo" ("owner");
CREATE INDEX IF NOT EXISTS "indexed_repo_ysws_idx" ON "indexed_repo" ("ysws_name");
CREATE INDEX IF NOT EXISTS "indexed_repo_airtable_idx" ON "indexed_repo" ("airtable_record_id");
CREATE INDEX IF NOT EXISTS "indexed_repo_contributors_gin" ON "indexed_repo" USING GIN ("contributor_usernames");

CREATE TABLE IF NOT EXISTS "indexed_file" (
  "id"             serial PRIMARY KEY,
  "repo_id"        integer NOT NULL REFERENCES "indexed_repo"("id") ON DELETE CASCADE,
  "path"           text NOT NULL,
  "basename"       text NOT NULL,
  "blob_sha"       text NOT NULL,
  "size_bytes"     integer NOT NULL,
  "is_kicad"       boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS "indexed_file_repo_idx" ON "indexed_file" ("repo_id");
CREATE INDEX IF NOT EXISTS "indexed_file_blob_sha_idx" ON "indexed_file" ("blob_sha");
CREATE INDEX IF NOT EXISTS "indexed_file_basename_idx" ON "indexed_file" ("basename");
