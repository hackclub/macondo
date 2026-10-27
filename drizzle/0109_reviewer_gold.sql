-- Reviewer earns 5 gold per approved ship. ADD VALUE must run outside a
-- transaction (Postgres disallows enum mutations inside a tx block).
ALTER TYPE "public"."currency_transaction_source" ADD VALUE IF NOT EXISTS 'review_reward';
