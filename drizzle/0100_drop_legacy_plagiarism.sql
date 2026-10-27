-- 0100_drop_legacy_plagiarism.sql
-- Drop the old in-process plagiarism index tables. With owo serving every
-- hardware fraud verdict, these tables (indexed_repo, indexed_file,
-- starter_fab_blob_sha) hold nothing the app reads. They occupied a large
-- share of Postgres disk, so dropping them up front saves space immediately.
--
-- IF EXISTS guards make this re-runnable on already-dropped state per the
-- project rule that every drizzle migration must be re-runnable on prod.

DROP TABLE IF EXISTS "starter_fab_blob_sha";
DROP TABLE IF EXISTS "indexed_file";
DROP TABLE IF EXISTS "indexed_repo";
