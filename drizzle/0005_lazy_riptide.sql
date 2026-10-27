ALTER TYPE "public"."ship_status" ADD VALUE 'rejected';--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "from_guide" boolean DEFAULT false;