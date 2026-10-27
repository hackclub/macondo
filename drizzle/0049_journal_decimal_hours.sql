-- Allow journals.hours and journals.override_hours to store partial-hour
-- values. Previously the columns were `integer`, which silently rounded
-- 0.5h sessions to 1h or 0h depending on direction; users complained
-- that "I worked 30 minutes" couldn't be recorded faithfully. Server
-- validation now rounds to 1 decimal place, matching the input step.
--
-- Existing integer values cast cleanly: 5 -> 5.00, no rows lost.

ALTER TABLE "journals"
  ALTER COLUMN "hours" TYPE numeric(10, 2) USING "hours"::numeric;

ALTER TABLE "journals"
  ALTER COLUMN "override_hours" TYPE numeric(10, 2) USING "override_hours"::numeric;
