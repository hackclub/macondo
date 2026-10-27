-- Per-file fab fingerprint (Phase B). Stores a structural signature
-- (currently from Gerber files; future: 3D mesh files) as JSONB so
-- comparisons can be done in JS with near-identical Hamming distance
-- math regardless of which extractor produced the signature.
--
-- Shape:
--   { "kind": "gerber-stream", "hash": "<64-bit hex>",
--     "apertureCount": int, "drawCount": int, "bboxX": float, "bboxY": float }
--
-- IF NOT EXISTS for prod re-runnability.

ALTER TABLE "indexed_file"
  ADD COLUMN IF NOT EXISTS "fab_fingerprint" jsonb;

-- Partial index so "find files with a fab fingerprint" is a fast point
-- lookup instead of a full table scan.
CREATE INDEX IF NOT EXISTS "indexed_file_fab_fp_idx"
  ON "indexed_file" ((fab_fingerprint IS NOT NULL))
  WHERE fab_fingerprint IS NOT NULL;
