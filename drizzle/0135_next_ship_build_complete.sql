-- Explicit per-project "is the next ship the finished build?" declaration.
-- Replaces the previous inference (build-complete == funding unticked), which
-- mislabelled every no-funding hardware ship as a finished build the student
-- never claimed and showed reviewers a false "they've received the parts"
-- banner. Snapshotted onto ships.is_build_complete_submission at submit time.
-- Defaults false so existing rows are treated as in-progress. Re-runnable.
ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "next_ship_is_build_complete" boolean DEFAULT false NOT NULL;
