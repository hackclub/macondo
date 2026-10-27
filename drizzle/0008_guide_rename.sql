ALTER TABLE "projects" RENAME COLUMN "from_guide" TO "guide";
ALTER TABLE "projects" ALTER COLUMN "guide" SET DATA TYPE text USING CASE WHEN "guide" = true THEN 'html' ELSE NULL END;
ALTER TABLE "projects" ALTER COLUMN "guide" SET DEFAULT NULL;
ALTER TABLE "users" ADD COLUMN "completed_guides" text[];
