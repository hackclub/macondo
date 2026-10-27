-- EasyEDA Pro `.epro` structural fingerprint, parallel to kicad_fingerprint.
-- Adds:
--   indexed_repo.epro_fingerprint  jsonb (SerializedEproFingerprint)
--   indexed_file.is_epro           boolean
-- Plus a GIN expression index on the netTopologyShas array so the Pass D
-- fingerprint-overlap lookup (`epro_fingerprint -> 'netTopologyShas' ?| ...`)
-- stays fast as the index grows.
--
-- IF NOT EXISTS guards keep this re-runnable on prod state per the
-- "Migrations must apply to prod" project rule.

ALTER TABLE "indexed_repo" ADD COLUMN IF NOT EXISTS "epro_fingerprint" jsonb;
ALTER TABLE "indexed_file" ADD COLUMN IF NOT EXISTS "is_epro" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "indexed_repo_epro_topology_gin"
  ON "indexed_repo" USING GIN ((epro_fingerprint -> 'netTopologyShas'));
