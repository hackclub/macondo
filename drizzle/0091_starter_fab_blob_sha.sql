-- Auto-detected starter fab blob SHAs. A SHA appearing in 5+ distinct
-- owners' repos via fab-extension files (3D models or Gerber/drill
-- output) is treated as a shared starter (hackpad enclosure, kit-supplied
-- 3D-print, standard Gerber template) and excluded from fab overlap math
-- at compute-tree-signals time. Refreshed by
-- server/plugins/plagiarism-index-cron.ts after each index refresh.
--
-- IF NOT EXISTS guards keep this re-runnable on prod state per the
-- "Migrations must apply to prod" project rule.

CREATE TABLE IF NOT EXISTS "starter_fab_blob_sha" (
  "blob_sha"     text PRIMARY KEY,
  "owner_count"  integer NOT NULL,
  "kind"         text NOT NULL,
  "detected_at"  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "starter_fab_kind_idx" ON "starter_fab_blob_sha" ("kind");
