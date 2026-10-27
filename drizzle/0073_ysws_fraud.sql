-- YSWS Fraud API integration columns on the ships table. Populated when a
-- Macondo reviewer escalates a ship via the "Send to Fraud Review" button.
-- See server/lib/ysws-fraud.ts and server/api/internal/cron/poll-ysws-fraud.post.ts.
ALTER TABLE "ships" ADD COLUMN "ysws_project_id" text;
--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN "ysws_trust_score" integer;
--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN "ysws_justification" text;
--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN "ysws_reviewed_at" timestamp;
--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN "ysws_outcome_recorded_at" timestamp;
