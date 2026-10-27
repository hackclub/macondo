-- Optional external RSVP/registration link for an event (e.g. a Luma page).
-- When set, the Explore event card swaps its "Go to channel" Slack button for
-- an "RSVP" button pointing here; when null the card keeps the channel link.
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "rsvp_url" text;
