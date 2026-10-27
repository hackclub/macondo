-- Flag a ship that intentionally skipped the YSWS Fraud API per the
-- low-effort-resubmit rule (a needs_changes resubmit that added less than
-- the new-work threshold). Lets the review queue suppress the red "No fraud
-- check" badge for these ships, whose missing fraud verdict is intentional
-- rather than a gap. Defaults false so every existing ship keeps the badge
-- behavior it had before.
--
-- Re-runnable per the project's migration contract (ADD COLUMN IF NOT
-- EXISTS, column carries its own default).

ALTER TABLE "ships"
	ADD COLUMN IF NOT EXISTS "fraud_review_skipped" boolean DEFAULT false NOT NULL;
