-- MCP server auth tables (server/lib/mcp/*). mcp_tokens are session-free bearer
-- tokens for the supaadmin MCP server: only the SHA256 hash of the raw token is
-- stored, and every /api/mcp request re-checks the owner still holds the
-- `supaadmin` role, so a demotion/revoke/expiry kills the token on the next
-- call. mcp_auth_codes are one-time OAuth 2.1 (PKCE) authorization codes used by
-- the claude.ai connector flow, hashed at rest and expiring in 5 minutes.
--
-- Foreign keys are declared inline so each table is created with its
-- constraints under a single CREATE TABLE IF NOT EXISTS guard, keeping the
-- migration re-runnable on prod state per the "Migrations must apply to prod"
-- rule (Postgres has no ADD CONSTRAINT IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS "mcp_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "user_id" text NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "last4" text NOT NULL,
  "can_write" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_used_at" timestamp,
  "expires_at" timestamp,
  "revoked_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_tokens_user_id_idx"
  ON "mcp_tokens" ("user_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mcp_auth_codes" (
  "id" text PRIMARY KEY NOT NULL,
  "code_hash" text NOT NULL UNIQUE,
  "user_id" text NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "can_write" boolean DEFAULT false NOT NULL,
  "code_challenge" text NOT NULL,
  "redirect_uri" text NOT NULL,
  "expires_at" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mcp_auth_codes_user_id_idx"
  ON "mcp_auth_codes" ("user_id");
