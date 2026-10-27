-- Adds the "extra fruity" reviewer flag and the starfruit unlock currency.
-- Reviewers tick a per-ship checkbox on approval to award the maker 1
-- starfruit (alongside the normal gold reward). Starfruit is recorded in
-- currency_transactions with fruit_type='starfruit', source either
-- 'extra_fruity_reward' (grant) or 'shop_unlock' (spend). Spending 1
-- starfruit unlocks a shop_items row whose own extra_fruity flag is true;
-- the unlock is one-time per (user, item) and is recorded in
-- shop_item_unlocks. After unlock the user buys the item normally with
-- gold/fruit. Idempotent: every ALTER/CREATE uses IF NOT EXISTS so the
-- migration can be replayed on a prod state that already has some of the
-- pieces.

ALTER TYPE "public"."currency_transaction_source"
  ADD VALUE IF NOT EXISTS 'extra_fruity_reward';--> statement-breakpoint
ALTER TYPE "public"."currency_transaction_source"
  ADD VALUE IF NOT EXISTS 'shop_unlock';--> statement-breakpoint

ALTER TABLE "ships"
  ADD COLUMN IF NOT EXISTS "extra_fruity" boolean DEFAULT false NOT NULL;--> statement-breakpoint

ALTER TABLE "shop_items"
  ADD COLUMN IF NOT EXISTS "extra_fruity" boolean DEFAULT false NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "shop_item_unlocks" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "item_id" integer NOT NULL,
  "currency_transaction_id" integer,
  "unlocked_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "shop_item_unlocks"
    ADD CONSTRAINT "shop_item_unlocks_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "shop_item_unlocks"
    ADD CONSTRAINT "shop_item_unlocks_item_id_shop_items_id_fk"
    FOREIGN KEY ("item_id") REFERENCES "shop_items"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "shop_item_unlocks"
    ADD CONSTRAINT "shop_item_unlocks_currency_transaction_id_currency_transactions_id_fk"
    FOREIGN KEY ("currency_transaction_id") REFERENCES "currency_transactions"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "shop_item_unlocks_user_item_idx"
  ON "shop_item_unlocks" ("user_id", "item_id");
