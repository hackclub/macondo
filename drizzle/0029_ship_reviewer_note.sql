-- Reviewer-note field on ships.
-- Added via the "I would like to add a reviewer note" checkbox in the
-- project submit flow. Surfaced on the internal review page so reviewers
-- see any context the student left at submit time.

ALTER TABLE "ships" ADD COLUMN IF NOT EXISTS "reviewer_note" text;
