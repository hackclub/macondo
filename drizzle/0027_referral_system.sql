-- User-to-user referral system.
-- Adds:
--   users.referral_code         5-char shareable code, unique, nullable
--   users.referred_by_user_id   who referred this user (nullable text, soft FK)
--   users.referred_at           when the referral was resolved on signin
--   referral_redemptions        tracks which tiers each user has claimed
--   currency_transaction_source += 'referral_reward'
-- All user columns nullable so existing rows stay intact.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" varchar(8);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referred_by_user_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referred_at" timestamp;--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "users" ADD CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code");
EXCEPTION
    WHEN duplicate_object THEN null;
    WHEN duplicate_table THEN null;
END $$;--> statement-breakpoint

ALTER TYPE "public"."currency_transaction_source" ADD VALUE IF NOT EXISTS 'referral_reward';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "referral_redemptions" (
    "id" serial PRIMARY KEY NOT NULL,
    "user_id" text NOT NULL,
    "tier" integer NOT NULL,
    "reward_summary" text NOT NULL,
    "redeemed_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
    ALTER TABLE "referral_redemptions"
      ADD CONSTRAINT "referral_redemptions_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
      ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "referral_redemptions_user_tier_unique" ON "referral_redemptions" USING btree ("user_id","tier");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referral_redemptions_user_idx" ON "referral_redemptions" USING btree ("user_id");
