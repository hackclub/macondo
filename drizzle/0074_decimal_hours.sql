-- Switch the integer "hours" columns to NUMERIC(10,2) so partial-hour
-- Hackatime activity is preserved instead of being rounded to a whole
-- hour at submission / sync time. Reviewers were seeing "1h" on a ship
-- with 35 minutes of actual time, which disagreed with the per-project
-- breakdown (0.6h) and was a source of fraud-review confusion.
ALTER TABLE "users" ALTER COLUMN "last_hackatime_total_hours" TYPE numeric(10, 2) USING "last_hackatime_total_hours"::numeric;
--> statement-breakpoint
ALTER TABLE "ships" ALTER COLUMN "hackatime_hours" TYPE numeric(10, 2) USING "hackatime_hours"::numeric;
--> statement-breakpoint
ALTER TABLE "hackatime_sync_audits" ALTER COLUMN "total_hours" TYPE numeric(10, 2) USING "total_hours"::numeric;
--> statement-breakpoint
ALTER TABLE "hackatime_sync_audits" ALTER COLUMN "delta_hours" TYPE numeric(10, 2) USING "delta_hours"::numeric;
