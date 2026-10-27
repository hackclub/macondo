-- Per-project draft of the next ship's optional "note to the reviewer".
--
-- Persisted as the student types (debounced) so toggling the reviewer-note
-- checkbox, or switching devices, never loses the text. Snapshotted onto
-- ship.reviewer_note at submit time and cleared with the other next_ship_*
-- fields afterward. Nullable; null means no draft note.
--
-- Re-runnable per the project's migration contract (ADD COLUMN IF NOT
-- EXISTS).

ALTER TABLE "projects"
	ADD COLUMN IF NOT EXISTS "next_ship_reviewer_note" text;
