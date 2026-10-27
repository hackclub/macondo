-- Personal API keys (`macondo_pat_<base64url>`): user-minted read-only bearer
-- auth for programmatic access to /api endpoints, so community tools stop
-- depending on expiring session cookies. Raw value is shown once at mint; only
-- the SHA256 hash is stored, mirroring mcp_tokens. Validated by
-- server/lib/api-keys.ts via server/middleware/1.api-key.ts.
CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" text PRIMARY KEY,
  "token_hash" text NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "last4" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "last_used_at" timestamp,
  "expires_at" timestamp,
  "revoked_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_token_hash_uq" ON "api_keys" ("token_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "api_keys_user_id_idx" ON "api_keys" ("user_id");
