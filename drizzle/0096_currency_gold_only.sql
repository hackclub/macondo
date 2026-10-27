-- Currency model collapses to gold-only. Fruits become a historical /
-- decorative concept: every reward path now writes a gold row
-- (currency_transactions.fruit_type IS NULL) at the gold-equivalent
-- amount, and pending hardware rewards are pending gold rows still tied
-- to pending_for_project_id / pending_for_ship_id with unlocked_at = NULL.
--
-- This migration adds the lifetime_fruits_earned counter on users AND
-- finishes the fruit→gold cutover for every existing user in a single
-- pass. Steps:
--   1. Add users.lifetime_fruits_earned (idempotent column add).
--   2. Backfill the counter from the pre-existing currency_transactions
--      ledger (sum of every increase row grouped by fruit_type per user).
--   3. Convert pending fruit rows in place to pending gold rows
--      (amount × goldPerFruit by fruit name, fruit_type → NULL).
--      pending_for_project_id / pending_for_ship_id stay so the
--      build-complete unlock and grant-conversion paths in
--      review.post.ts keep working on the converted rows.
--   4. For each user with a positive unlocked fruit balance, insert one
--      "Currency migration:" gold row equal to the gold-equivalent of
--      that balance, then mark every counts=true unlocked fruit row as
--      counts=false so it stays in audit history but no longer affects
--      balance.
--   5. Rewrite shop item fruit pricing to gold (price_hours derived
--      from price_fruit_amount × goldPerFruit, ceil'd to whole hours so
--      buyers never under-pay vs. the pre-migration price). The four
--      price_fruit_* columns are nulled so future writers ignore them.
--
-- Every step is idempotent: re-running this migration on already-migrated
-- state is a no-op.
--
-- Conversion rates (must match app/data/fruitLevels.ts levelConfig):
--   Level 1 (Mango / Guava):       5 gold/fruit
--   Level 2 (Pineapple / Coconut): 15 gold/fruit
--   Level 3 (Papaya / Watermelon): 25 gold/fruit
--   Level 4 (Cocoa / Avocado):     60 gold/fruit
--
-- IF NOT EXISTS guards on the column add keep this re-runnable on prod
-- state per the "Migrations must apply to prod" project rule.

-- Step 1: schema column add.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "lifetime_fruits_earned" jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Step 2: backfill users.lifetime_fruits_earned from the existing fruit
-- ledger. Only writes for users whose counter is empty so a re-run after
-- ship-approval increments doesn't clobber growth.
WITH per_user_totals AS (
  SELECT
    user_id,
    fruit_type,
    SUM(amount)::numeric AS total
  FROM currency_transactions
  WHERE type = 'increase'
    AND fruit_type IS NOT NULL
    AND counts = TRUE
  GROUP BY user_id, fruit_type
),
agg AS (
  SELECT
    user_id,
    jsonb_object_agg(fruit_type, total) AS totals
  FROM per_user_totals
  WHERE total > 0
  GROUP BY user_id
)
UPDATE users u
SET lifetime_fruits_earned = agg.totals
FROM agg
WHERE u.id = agg.user_id
  AND (u.lifetime_fruits_earned IS NULL OR u.lifetime_fruits_earned = '{}'::jsonb);

-- Step 3: convert pending fruit rows in place to pending gold rows.
-- After this, no row in the table has both fruit_type IS NOT NULL AND
-- unlocked_at IS NULL. The CASE encodes the rate per known fruit name.
-- Unknown fruit_types (none today; this is defensive) are left at amount × 1
-- so they don't silently drop value, but they are still nulled so they
-- count as gold going forward.
UPDATE currency_transactions
SET amount = amount * CASE fruit_type
      WHEN 'Mango'      THEN 5
      WHEN 'Guava'      THEN 5
      WHEN 'Pineapple'  THEN 15
      WHEN 'Coconut'    THEN 15
      WHEN 'Papaya'     THEN 25
      WHEN 'Watermelon' THEN 25
      WHEN 'Cocoa'      THEN 60
      WHEN 'Avocado'    THEN 60
      ELSE 1
    END,
    fruit_type = NULL,
    memo = COALESCE(memo, '') || ' [auto-converted to gold by fruit-to-gold migration]'
WHERE fruit_type IS NOT NULL
  AND unlocked_at IS NULL;

-- Step 4a: settle each user's unlocked fruit balance. Insert one gold
-- conversion row per user equal to the floored gold-equivalent of their
-- per-fruit-type net balance, then (in step 4b) retire the source rows.
-- The NOT EXISTS guard makes this idempotent: re-running the migration
-- skips users that already have a "Currency migration:" marker row.
WITH per_user_balances AS (
  SELECT
    ct.user_id,
    SUM(
      (CASE WHEN ct.type = 'increase' THEN ct.amount ELSE -ct.amount END)
      * CASE ct.fruit_type
          WHEN 'Mango'      THEN 5
          WHEN 'Guava'      THEN 5
          WHEN 'Pineapple'  THEN 15
          WHEN 'Coconut'    THEN 15
          WHEN 'Papaya'     THEN 25
          WHEN 'Watermelon' THEN 25
          WHEN 'Cocoa'      THEN 60
          WHEN 'Avocado'    THEN 60
          ELSE 0
        END
    ) AS gold_total
  FROM currency_transactions ct
  WHERE ct.fruit_type IS NOT NULL
    AND ct.unlocked_at IS NOT NULL
    AND ct.counts = TRUE
  GROUP BY ct.user_id
)
INSERT INTO currency_transactions (
  user_id, amount, type, source, fruit_type, memo, counts, unlocked_at
)
SELECT
  pb.user_id,
  FLOOR(pb.gold_total)::numeric,
  'increase',
  'system',
  NULL,
  'Currency migration: converted unlocked fruit balance to '
    || FLOOR(pb.gold_total)::text
    || ' gold at level rates',
  TRUE,
  NOW()
FROM per_user_balances pb
WHERE pb.gold_total > 0
  AND NOT EXISTS (
    SELECT 1
    FROM currency_transactions m
    WHERE m.user_id = pb.user_id
      AND m.source = 'system'
      AND m.memo LIKE 'Currency migration:%'
  );

-- Step 4b: retire every counts=true unlocked fruit row so the new gold
-- conversion row is the only thing the balance query sees from this
-- user's pre-migration history. Rows stay in the table for audit, just
-- with counts=false.
UPDATE currency_transactions
SET counts = FALSE,
    memo = COALESCE(memo, '') || ' [retired: balance moved to gold by fruit-to-gold migration]'
WHERE fruit_type IS NOT NULL
  AND unlocked_at IS NOT NULL
  AND counts = TRUE;

-- Step 5: rewrite shop item fruit pricing to gold. Two pre-migration
-- shapes existed:
--   - specific fruit (legacy):  price_fruit_type + price_fruit_amount
--   - level + category (newer): price_fruit_level + price_fruit_category
--                                + price_fruit_amount
-- For both we compute price_fruit_amount × goldPerFruit, then convert
-- gold to whole hours via CEIL(... / 10) (server/lib/shop.ts has
-- GOLD_PER_HOUR = 10). GREATEST keeps any pre-existing price_hours value
-- if the admin had already entered one (post-fruit-priced items zeroed
-- it; gold-priced items skip this UPDATE entirely via the WHERE clause).
UPDATE shop_items
SET price_hours = GREATEST(
      price_hours,
      CEIL(
        price_fruit_amount::numeric * (
          CASE
            WHEN price_fruit_type IS NOT NULL THEN
              CASE price_fruit_type
                WHEN 'Mango'      THEN 5
                WHEN 'Guava'      THEN 5
                WHEN 'Pineapple'  THEN 15
                WHEN 'Coconut'    THEN 15
                WHEN 'Papaya'     THEN 25
                WHEN 'Watermelon' THEN 25
                WHEN 'Cocoa'      THEN 60
                WHEN 'Avocado'    THEN 60
                ELSE 0
              END
            WHEN price_fruit_level IS NOT NULL THEN
              CASE price_fruit_level
                WHEN 1 THEN 5
                WHEN 2 THEN 15
                WHEN 3 THEN 25
                WHEN 4 THEN 60
                ELSE 0
              END
            ELSE 0
          END
        ) / 10.0
      )::int
    ),
    price_fruit_type = NULL,
    price_fruit_amount = NULL,
    price_fruit_level = NULL,
    price_fruit_category = NULL,
    updated_at = NOW()
WHERE price_fruit_type IS NOT NULL
   OR price_fruit_amount IS NOT NULL
   OR price_fruit_level IS NOT NULL
   OR price_fruit_category IS NOT NULL;
