-- Capybara similar-ticket replies.
--
-- When a new support ticket is filed, an embedding of subject+body is
-- compared against the corpus of prior tickets. If anything clears the
-- cosine similarity threshold, a "Capybara" message is auto-posted in
-- the ticket thread with links to the suggestions. See the plan in
-- C:\Users\Nathan\.claude\plans\in-the-shop-the-precious-fiddle.md.
--
-- Schema changes in this migration:
--   1. pgvector extension (no-op if already enabled).
--   2. support_tickets.embedding vector(1536) for the cosine search.
--      Dimension matches text-embedding-3-small from aiEmbed().
--   3. HNSW index on support_tickets.embedding for fast similarity
--      lookup. Cosine ops match our 1 - (a <=> b) similarity score.
--   4. support_ticket_messages.author_kind discriminator. Default
--      "user" keeps every legacy row valid; Capybara posts use
--      "capybara" with a null author_user_id.
--   5. support_ticket_messages.author_user_id becomes nullable so the
--      Capybara author has no FK row.
--
-- Re-runnable per the project's migration contract (IF NOT EXISTS,
-- guarded DROP NOT NULL).

CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint

ALTER TABLE "support_tickets"
	ADD COLUMN IF NOT EXISTS "embedding" vector(1536);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "support_tickets_embedding_hnsw"
	ON "support_tickets" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint

ALTER TABLE "support_ticket_messages"
	ADD COLUMN IF NOT EXISTS "author_kind" text NOT NULL DEFAULT 'user';--> statement-breakpoint

-- Drop NOT NULL on author_user_id only if it is currently NOT NULL.
-- Postgres has no DROP NOT NULL IF EXISTS, so use a guarded DO block
-- against information_schema. Idempotent on prod state.
DO $$ BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'support_ticket_messages'
			AND column_name = 'author_user_id'
			AND is_nullable = 'NO'
	) THEN
		ALTER TABLE "support_ticket_messages"
			ALTER COLUMN "author_user_id" DROP NOT NULL;
	END IF;
END $$;--> statement-breakpoint
