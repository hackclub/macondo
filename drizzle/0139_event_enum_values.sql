-- New enum values for the events feature.
--   notification_type 'event_prize'    : a supaadmin approved an event gift.
--   notification_type 'event_reminder' : the 30-min-before Capybara reminder DM.
--   currency_transaction_source 'event_prize' : real gold credited by an
--     approved gold gift (free shop-item gifts never touch the ledger).
--
-- Kept isolated in its own migration (matching 0121/0127) so the new enum
-- values are committed before any later migration or runtime code uses them,
-- avoiding the Postgres "unsafe use of new value of enum type" error.
--
-- IF NOT EXISTS makes this safe to re-run on prod (CLAUDE.md migration rule).

ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'event_prize';
ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'event_reminder';
ALTER TYPE "public"."currency_transaction_source" ADD VALUE IF NOT EXISTS 'event_prize';
