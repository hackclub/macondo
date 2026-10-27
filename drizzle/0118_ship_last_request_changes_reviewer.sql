-- Track the human reviewer who last sent a ship to needs_changes.
--
-- Read on resubmit so a request-changes resubmit can be routed straight
-- back to the reviewer who bounced it: immediately when fraud review is
-- skipped, or after fraud clears via autoAssignShipAfterFraudReview. Set
-- only on the reviewer path (not the uwu auto-bounce path) by
-- markShipNeedsChanges. Nullable; null means "no human reviewer recorded"
-- and the resubmit falls back to the general queue.
--
-- Re-runnable per the project's migration contract (ADD COLUMN IF NOT
-- EXISTS, EXCEPTION-swallowed FK add).

ALTER TABLE "ships"
	ADD COLUMN IF NOT EXISTS "last_request_changes_reviewer_id" text;--> statement-breakpoint

DO $$ BEGIN
	ALTER TABLE "ships" ADD CONSTRAINT "ships_last_request_changes_reviewer_id_users_id_fk"
		FOREIGN KEY ("last_request_changes_reviewer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
