-- Allow fractional fruit/gold (e.g. 7.35 from a 1.05x streak on a base of 7).
-- Existing integer rows cast cleanly to numeric with no precision loss.
ALTER TABLE "currency_transactions"
  ALTER COLUMN "amount" TYPE numeric(14, 4) USING "amount"::numeric(14, 4);
