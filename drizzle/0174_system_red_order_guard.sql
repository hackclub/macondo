-- System actor for check-red-orders-cron's automatic cancels of Hackatime-red buyers' orders.
-- Same shape as 0168_system_actors.sql. Idempotent and re-runnable.

INSERT INTO "users" ("id", "name", "email", "is_system", "is_temp", "onboarding_step")
VALUES
  ('system-red-order-guard', 'red order guard (system)', 'red-order-guard@system.macondo.invalid', true, false, 'complete')
ON CONFLICT ("id") DO UPDATE
  SET "is_system" = true,
      "name" = EXCLUDED."name";
