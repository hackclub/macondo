-- Separate fruit inventory from gold. fruit_type=null means the row
-- contributes to gold; non-null means the row is an inventory of that
-- specific fruit (e.g. "Watermelon"). Convert-to-gold = decrease row
-- with fruit_type=X + increase row with fruit_type=null at tier rate.
ALTER TABLE "currency_transactions" ADD COLUMN "fruit_type" text;

-- Backfill existing ship-linked rewards as fruit of the project's kind.
-- Rows without a ship_id stay null (genuine gold). This makes the
-- pre-split history match the new semantics so balances don't jump.
UPDATE "currency_transactions" ct
SET "fruit_type" = p."fruit"
FROM "ships" s
JOIN "projects" p ON p.id = s.project_id
WHERE ct.ship_id = s.id
  AND ct.fruit_type IS NULL
  AND p.fruit IS NOT NULL;
