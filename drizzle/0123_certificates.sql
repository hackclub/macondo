-- Adds the certificates table. A maker claims a certificate of completion
-- after buying an Event Invite in the shop; the unlock gate lives in
-- server/lib/certificates.ts. "code" is the public, shareable, verifiable
-- identifier; the uuid "id" is the internal key. recipient_name and
-- hours_at_issue are snapshotted at claim time so later PII edits or hour
-- recomputes never alter an already-issued public certificate. The partial
-- unique index enforces one active (non-revoked) certificate per user while
-- still allowing re-issue after a revoke.
--
-- IF NOT EXISTS / DO $$ BEGIN ... EXCEPTION wrappers make this re-runnable
-- on prod state per the "Migrations must apply to prod" rule.

CREATE TABLE IF NOT EXISTS "certificates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "code" varchar(16) NOT NULL,
  "hours_at_issue" numeric(10, 2) NOT NULL,
  "recipient_name" text NOT NULL,
  "issued_at" timestamp DEFAULT now() NOT NULL,
  "revoked_at" timestamp,
  "revoked_reason" text,
  "issuer_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "certificates_code_unique" UNIQUE("code")
);

DO $$ BEGIN
  ALTER TABLE "certificates"
    ADD CONSTRAINT "certificates_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "certificates"
    ADD CONSTRAINT "certificates_issuer_id_users_id_fk"
    FOREIGN KEY ("issuer_id") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "certificates_one_active_per_user"
  ON "certificates" ("user_id")
  WHERE "revoked_at" IS NULL;

CREATE INDEX IF NOT EXISTS "certificates_user_idx"
  ON "certificates" ("user_id");
