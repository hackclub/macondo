-- Defect D: distinct identities for machine-generated audit rows.
--
-- audit_logs.actor_id is NOT NULL with an FK to users.id, so every automated
-- writer previously borrowed the ship owner's id. That makes the audit trail
-- unable to distinguish a system action from a user action, which undermines
-- it as evidence in fraud and fine disputes.
--
-- These are real users rows so the FK stays enforced, marked is_system so
-- every people-facing surface can exclude them. They carry no roles, no
-- slack_id, and an RFC 2606 .invalid email that can never receive mail.
--
-- Idempotent and re-runnable per the project's migration contract.

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_system" boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "users_is_system_idx" ON "users" ("is_system");

INSERT INTO "users" ("id", "name", "email", "is_system", "is_temp", "onboarding_step")
VALUES
  ('system-check-dispatcher',  'check dispatcher (system)',  'check-dispatcher@system.macondo.invalid',  true, false, 'complete'),
  ('system-owo-poller',        'owo poller (system)',        'owo-poller@system.macondo.invalid',        true, false, 'complete'),
  ('system-uwu-poller',        'uwu poller (system)',        'uwu-poller@system.macondo.invalid',        true, false, 'complete'),
  ('system-check-sweeper',     'check sweeper (system)',     'check-sweeper@system.macondo.invalid',     true, false, 'complete'),
  ('system-review-escalation', 'review escalation (system)', 'review-escalation@system.macondo.invalid', true, false, 'complete')
ON CONFLICT ("id") DO UPDATE
  SET "is_system" = true,
      "name" = EXCLUDED."name";
