-- Staff-confirmed event attendance. attended_at IS NOT NULL is the new
-- certificate unlock gate (certificates are earned by going to the event, not
-- by holding a ticket), and it is only ever set by hand from the internal
-- event editor, so issuance is manual-approval-only by construction.
--
-- Re-runnable per the migration contract: ADD COLUMN IF NOT EXISTS, guarded
-- ADD CONSTRAINT.

ALTER TABLE "event_attendees" ADD COLUMN IF NOT EXISTS "attended_at" timestamp;
ALTER TABLE "event_attendees" ADD COLUMN IF NOT EXISTS "attendance_marked_by" text;

DO $$ BEGIN
  ALTER TABLE "event_attendees"
    ADD CONSTRAINT "event_attendees_attendance_marked_by_users_id_fk"
    FOREIGN KEY ("attendance_marked_by") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The certificate gate is a per-user EXISTS lookup on attended rows.
CREATE INDEX IF NOT EXISTS "event_attendees_user_attended_idx"
  ON "event_attendees" ("user_id") WHERE "attended_at" IS NOT NULL;
