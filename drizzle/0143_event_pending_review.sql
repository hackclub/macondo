-- Events now go through a supaadmin "second pass" before launching: an events
-- organizer submits an event (status 'pending_review'), and a supaadmin
-- accepts it to launch (announce). Isolated enum-add migration per the
-- 0121/0127 precedent; re-runnable via ADD VALUE IF NOT EXISTS.

ALTER TYPE "public"."event_status" ADD VALUE IF NOT EXISTS 'pending_review';
