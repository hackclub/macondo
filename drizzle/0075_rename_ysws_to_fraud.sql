-- Rename the YSWS-prefixed fraud-review columns on `ships` to fraud_*. The
-- columns describe how we use the data internally ("fraud review state on
-- the ship"), not the external API. Aligning the schema with the existing
-- pending_fraud_review status / fraud-reviews UI removes the YSWS leak from
-- the data model. The runtime config keys and env vars (NUXT_YSWS_FRAUD_*)
-- still name the external API and stay as-is.
ALTER TABLE "ships" RENAME COLUMN "ysws_project_id" TO "fraud_project_id";
--> statement-breakpoint
ALTER TABLE "ships" RENAME COLUMN "ysws_trust_score" TO "fraud_trust_score";
--> statement-breakpoint
ALTER TABLE "ships" RENAME COLUMN "ysws_justification" TO "fraud_justification";
--> statement-breakpoint
ALTER TABLE "ships" RENAME COLUMN "ysws_reviewed_at" TO "fraud_reviewed_at";
--> statement-breakpoint
ALTER TABLE "ships" RENAME COLUMN "ysws_outcome_recorded_at" TO "fraud_outcome_recorded_at";
