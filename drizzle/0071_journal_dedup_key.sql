-- Idempotency key for retry-safe journal inserts. The journal editor
-- generates a UUID per submit; the create endpoint checks for an
-- existing row with the same (project_id, client_dedup_key) before
-- inserting a new one. Blueprint imports leave it null because that
-- path is bulk and explicitly intended to insert N rows in one call.
--
-- Partial unique index: only enforces uniqueness when client_dedup_key
-- is NOT NULL, so legacy rows and blueprint-imported rows coexist as nulls.

ALTER TABLE "journals"
  ADD COLUMN IF NOT EXISTS "client_dedup_key" varchar(64);

CREATE UNIQUE INDEX IF NOT EXISTS "journals_dedup_unique"
  ON "journals" ("project_id", "client_dedup_key")
  WHERE "client_dedup_key" IS NOT NULL;
