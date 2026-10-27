-- Group projects file one Unified YSWS row per contributor, so each member's
-- record id needs a home. ships.airtable_record_id keeps holding the owner's
-- (every repair / health / force-resync path reads it), and this column holds
-- the same id for the owner plus one for every co-maker, so a re-sync PATCHes
-- their rows instead of POSTing duplicates.
ALTER TABLE "ship_contributors" ADD COLUMN IF NOT EXISTS "airtable_record_id" text;
