ALTER TABLE "ships" ADD COLUMN "software_override_hours" integer DEFAULT 0;
ALTER TABLE "ships" ADD COLUMN "software_override_reason" text;
ALTER TABLE "ships" ADD COLUMN "decision_justification" text;
