-- Supporter knowledge base (KB) tables.
--
-- A curated, source-cited knowledge base for the support "supporter"
-- agent. kb_entries holds published Q&A / guide content with a pgvector
-- embedding for retrieval; kb_sources maps each entry to one or more
-- origins (resolved ticket, doc, faq, message, or external url) with an
-- immutable snapshot of the cited text; kb_suggestions is the human
-- review queue the curation pipeline and learning loop feed.
--
-- Re-runnable per the project's migration contract: IF NOT EXISTS on
-- every create, guarded DO blocks for enum types, and inline foreign
-- keys (created with the table, so a re-run skips them via the table's
-- IF NOT EXISTS guard).

CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "kb_entry_status" AS ENUM ('draft', 'published', 'archived');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "kb_source_type" AS ENUM ('support_ticket', 'doc_path', 'faq_entry', 'message', 'external_url');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
	CREATE TYPE "kb_suggestion_status" AS ENUM ('pending', 'accepted', 'rejected', 'archived');
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "kb_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body_en" text NOT NULL,
	"body_es" text,
	"type" text DEFAULT 'guide' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"status" "kb_entry_status" DEFAULT 'draft' NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"valid_from" timestamp,
	"valid_until" timestamp,
	"last_verified_at" timestamp,
	"last_verified_by_user_id" text REFERENCES "users"("id"),
	"embedding" vector(1536),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text NOT NULL REFERENCES "users"("id"),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "kb_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"kb_entry_id" integer NOT NULL REFERENCES "kb_entries"("id") ON DELETE CASCADE,
	"source_type" "kb_source_type" NOT NULL,
	"source_ref" text NOT NULL,
	"citation_text" text NOT NULL,
	"added_by_user_id" text REFERENCES "users"("id"),
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "kb_suggestions" (
	"id" serial PRIMARY KEY NOT NULL,
	"question_en" text NOT NULL,
	"answer_en" text NOT NULL,
	"question_es" text,
	"answer_es" text,
	"status" "kb_suggestion_status" DEFAULT 'pending' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"source_ticket_count" integer DEFAULT 0 NOT NULL,
	"source_ticket_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reviewed_by_user_id" text REFERENCES "users"("id"),
	"reviewed_at" timestamp,
	"published_kb_id" integer REFERENCES "kb_entries"("id") ON DELETE SET NULL,
	"raw_ai_response" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "kb_entries_status_idx" ON "kb_entries" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_entries_category_idx" ON "kb_entries" ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_entries_sort_idx" ON "kb_entries" ("sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_entries_created_idx" ON "kb_entries" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_entries_embedding_hnsw" ON "kb_entries" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_sources_entry_idx" ON "kb_sources" ("kb_entry_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_sources_type_idx" ON "kb_sources" ("source_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_suggestions_status_idx" ON "kb_suggestions" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_suggestions_category_idx" ON "kb_suggestions" ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_suggestions_created_idx" ON "kb_suggestions" ("created_at");
