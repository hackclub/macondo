-- Track the Airtable record id we get back when syncing a ship to the
-- YSWS submissions base. Without this column the force-resync endpoint
-- has to re-POST (creating a duplicate row), and we have no way to
-- re-verify or surface a clickable link to the existing Airtable record
-- from the internal review page. Backfilled by
-- scripts/backfill-airtable-record-ids.ts using a Code URL match
-- against the existing Airtable rows.
ALTER TABLE "ships" ADD COLUMN "airtable_record_id" text;
