ALTER TABLE "journals" ADD COLUMN "content_language" varchar(5);--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN "update_verified_by_reviewer" boolean DEFAULT false NOT NULL;