-- Post-hoc fraud verification verdict on ships ('approved' | 'rejected',
-- null while the upstream case is open or never checked). Gates shop
-- fulfillment: a buyer's orders wait until every gold-earning ship is
-- fraud-clean. Re-runnable on prod state per the migration rules.
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "fraud_outcome" text;
