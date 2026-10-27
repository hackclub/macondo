-- Adds a new notification_type enum value fired when a reviewer marks a
-- ship as extra fruity, either during the initial approval or after-the-fact
-- via /internal/review/[shipId]. The maker is told their specific ship was
-- flagged and earned +1 starfruit.
--
-- Per-ship: flipping one ship's flag never affects sibling ships of the same
-- project, so the notification copy refers to the individual ship.
--
-- IF NOT EXISTS makes this safe to re-run on prod, matching the project rule
-- that every migration must be idempotent (see CLAUDE.md).

ALTER TYPE "public"."notification_type" ADD VALUE IF NOT EXISTS 'ship_extra_fruity';
