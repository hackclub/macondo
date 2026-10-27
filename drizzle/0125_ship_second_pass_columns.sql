-- Second-pass review snapshot columns on ships. Set when a reviewer approves
-- a queue ship into status='pending_second_pass'; read by
-- server/lib/finalize-ship-approval.ts when a supaadmin confirms. We snapshot
-- only the reward values that can drift while the ship waits (streak
-- multiplier, level-derived fruit, the group split); deterministic values
-- (approved hours, funded hours, gating) are recomputed at finalize from the
-- already-persisted ship/project columns.
--
-- All columns are nullable (legacy rows + ships that never enter second pass
-- carry NULL). IF NOT EXISTS / DO $$ EXCEPTION wrappers keep this re-runnable
-- on prod state per the "Migrations must apply to prod" rule.
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "first_pass_reviewer_id" text;--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "first_pass_approved_at" timestamp;--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "first_pass_reveal_identity" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "second_pass_actioned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "second_pass_gold_reward" integer;--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "second_pass_multiplier" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "second_pass_lifetime_fruit_delta" integer;--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "second_pass_assigned_fruit" text;--> statement-breakpoint
ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "second_pass_contributor_split" jsonb;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ships"
    ADD CONSTRAINT "ships_first_pass_reviewer_id_users_id_fk"
    FOREIGN KEY ("first_pass_reviewer_id") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
