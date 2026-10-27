-- Supaadmin manual gold add/subtract on the internal user profile finance
-- section. Adds the currency_transactions source tag for those ledger rows and
-- the notification_type fired to the maker (the staff note is shown in-app).
--
-- IF NOT EXISTS keeps this re-runnable on prod state, matching the project rule
-- that every migration must be idempotent (see CLAUDE.md).

ALTER TYPE "public"."currency_transaction_source" ADD VALUE IF NOT EXISTS 'admin_adjustment';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'gold_adjusted';
