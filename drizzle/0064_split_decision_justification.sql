-- Split the single ship.decision_justification field into two: an internal
-- audit field that goes to Airtable, and a user-facing message shown to the
-- student on their project page + emailed on rejection / needs_changes.
--
-- Renames keep historic data; the new decision_user_message column is
-- backfilled from the renamed audit text so historic ships keep rendering
-- their existing student-facing copy in the timeline and rejection banner.

ALTER TABLE "ships" RENAME COLUMN "decision_justification" TO "decision_audit_notes";
ALTER TABLE "ships" RENAME COLUMN "decision_justification_translations" TO "decision_user_message_translations";
ALTER TABLE "ships" ADD COLUMN "decision_user_message" text;

UPDATE "ships"
SET "decision_user_message" = "decision_audit_notes"
WHERE "decision_audit_notes" IS NOT NULL;
