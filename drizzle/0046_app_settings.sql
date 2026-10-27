-- Generic key/value store for global app flags. First user is the
-- "shop_under_renovation" toggle that hides every shop item from the
-- public store while admins reorganize. Future flags can reuse the
-- same table without another migration.
--
-- value is jsonb so flags can carry richer payloads later (e.g. a
-- renovation reason / ETA) without a schema change. updated_by points
-- at users.id (text PK in this codebase) so audit logs aren't the only
-- record of who flipped what.

CREATE TABLE IF NOT EXISTS "app_settings" (
  "key" text PRIMARY KEY NOT NULL,
  "value" jsonb,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "updated_by" text REFERENCES "users"("id")
);
