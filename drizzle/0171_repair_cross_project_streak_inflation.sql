CREATE TEMP TABLE cross_project_streak_audit_repairs ON COMMIT DROP AS
WITH raw_events AS (
  SELECT
    a.id AS audit_id,
    a.created_at,
    a.entity_id::integer AS project_id,
    a.actor_id AS user_id,
    (a.old_value->>'project_streak_days')::integer AS old_streak,
    a.old_value->>'last_worked_date' AS old_last_worked,
    (a.new_value->>'project_streak_days')::integer AS bad_streak,
    a.new_value->>'last_worked_date' AS bad_last_worked,
    a.new_value->>'walk_floor' AS walk_floor
  FROM audit_logs a
  WHERE a.entity_type = 'project'
    AND a.action = 'project_streak_extend'
    AND a.created_at >= TIMESTAMP '2026-08-17 10:21:00'
    AND a.entity_id ~ '^[0-9]+$'
    AND a.old_value->>'project_streak_days' ~ '^[0-9]+$'
    AND a.new_value->>'project_streak_days' ~ '^[0-9]+$'
    AND a.new_value->>'backfilled' = 'true'
    AND a.new_value->>'auto_use_streak_freezes' = 'true'
    AND a.new_value->>'walk_floor' ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
), first_events AS (
  SELECT DISTINCT ON (project_id)
    project_id,
    old_streak AS baseline_streak,
    old_last_worked AS baseline_last_worked,
    walk_floor
  FROM raw_events
  ORDER BY project_id, created_at, audit_id
), events AS (
  SELECT r.*, f.baseline_streak, f.baseline_last_worked, f.walk_floor AS baseline_walk_floor
  FROM raw_events r
  JOIN first_events f USING (project_id)
  WHERE r.bad_last_worked ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
), own_days AS (
  SELECT e.audit_id, d.day
  FROM events e
  JOIN daily_project_activity d
    ON d.user_id = e.user_id
   AND d.project_id = e.project_id
   AND d.day BETWEEN e.baseline_walk_floor AND e.bad_last_worked
  WHERE d.journal_seconds + d.hackatime_seconds >= 3600
), first_own_days AS (
  SELECT audit_id, min(day) AS first_own_day
  FROM own_days
  GROUP BY audit_id
), counted_days AS (
  SELECT audit_id, day FROM own_days
  UNION
  SELECT e.audit_id, s.day
  FROM events e
  JOIN first_own_days f USING (audit_id)
  JOIN streak_days s
    ON s.user_id = e.user_id
   AND s.status = 'frozen'
   AND s.day > f.first_own_day
   AND s.day <= e.bad_last_worked
), metrics AS (
  SELECT
    e.*,
    count(c.day)::integer AS recomputed_streak,
    max(c.day) AS recomputed_last_worked,
    count(c.day) FILTER (
      WHERE e.baseline_last_worked IS NOT NULL
        AND c.day > e.baseline_last_worked
    )::integer AS stranded_after_last_worked
  FROM events e
  LEFT JOIN counted_days c USING (audit_id)
  GROUP BY
    e.audit_id, e.created_at, e.project_id, e.user_id, e.old_streak,
    e.old_last_worked, e.bad_streak, e.bad_last_worked, e.walk_floor,
    e.baseline_streak, e.baseline_last_worked, e.baseline_walk_floor
), expected AS (
  SELECT
    m.*,
    CASE
      WHEN m.recomputed_streak > m.baseline_streak THEN m.recomputed_streak
      WHEN m.baseline_last_worked IS NOT NULL AND m.stranded_after_last_worked > 0
        THEN m.baseline_streak + m.stranded_after_last_worked
      ELSE m.baseline_streak
    END AS expected_streak,
    CASE
      WHEN m.recomputed_streak > m.baseline_streak THEN m.recomputed_last_worked
      WHEN m.baseline_last_worked IS NOT NULL AND m.stranded_after_last_worked > 0
        THEN m.recomputed_last_worked
      ELSE m.baseline_last_worked
    END AS expected_last_worked
  FROM metrics m
)
SELECT
  e.*,
  e.bad_streak - e.expected_streak AS inflation
FROM expected e
WHERE e.bad_streak > e.expected_streak;

CREATE TEMP TABLE cross_project_streak_repairs ON COMMIT DROP AS
SELECT DISTINCT ON (a.project_id)
  a.project_id,
  a.user_id,
  a.created_at AS evidence_created_at,
  a.bad_streak AS evidence_bad_streak,
  a.bad_last_worked AS evidence_bad_last_worked,
  a.expected_streak AS evidence_expected_streak,
  a.expected_last_worked AS evidence_expected_last_worked,
  a.inflation,
  p.project_streak_days AS old_streak,
  p.last_worked_date AS old_last_worked,
  p.project_streak_days - a.inflation AS corrected_streak,
  CASE
    WHEN p.last_worked_date = a.bad_last_worked THEN a.expected_last_worked
    ELSE p.last_worked_date
  END AS corrected_last_worked
FROM cross_project_streak_audit_repairs a
JOIN projects p ON p.id = a.project_id
WHERE p.project_streak_days >= a.bad_streak
  AND NOT EXISTS (
    SELECT 1
    FROM audit_logs prior
    WHERE prior.action = 'cross_project_streak_inflation_repaired'
      AND prior.entity_type = 'project'
      AND prior.entity_id = a.project_id::text
  )
ORDER BY a.project_id, a.created_at DESC, a.audit_id DESC;

INSERT INTO audit_logs (
  actor_id, action, entity_type, entity_id, old_value, new_value, sensitive, change_summary
)
SELECT
  r.user_id,
  'cross_project_streak_inflation_repaired',
  'project',
  r.project_id::text,
  jsonb_build_object(
    'project_streak_days', r.old_streak,
    'last_worked_date', r.old_last_worked,
    'evidence_audit_created_at', r.evidence_created_at,
    'evidence_bad_streak', r.evidence_bad_streak
  ),
  jsonb_build_object(
    'project_streak_days', r.corrected_streak,
    'last_worked_date', r.corrected_last_worked,
    'removed_days', r.inflation,
    'evidence_expected_streak', r.evidence_expected_streak,
    'bad_deploy_started_at', '2026-08-17T10:21:00Z'
  ),
  false,
  'Removed only the excess reproduced by replaying the bad cross-project recompute.'
FROM cross_project_streak_repairs r;

UPDATE projects p
SET
  project_streak_days = r.corrected_streak,
  last_worked_date = r.corrected_last_worked,
  stage = CASE
    WHEN r.corrected_streak >= 10 THEN 4
    WHEN r.corrected_streak >= 6 THEN 3
    WHEN r.corrected_streak >= 3 THEN 2
    ELSE 1
  END,
  updated_at = now()
FROM cross_project_streak_repairs r
WHERE p.id = r.project_id;

CREATE TEMP TABLE cross_project_ship_repairs ON COMMIT DROP AS
WITH submission_events AS (
  SELECT DISTINCT ON (a.entity_id)
    a.id AS audit_id,
    a.created_at,
    a.entity_id::integer AS ship_id,
    (a.new_value->>'project_id')::integer AS project_id,
    (a.new_value->>'project_streak_days_at_submission')::integer AS bad_snapshot,
    a.new_value->>'project_last_worked_date_at_submission' AS bad_last_worked_snapshot,
    CASE
      WHEN a.action = 'resubmit_project_for_review'
        AND a.old_value->>'project_streak_days_at_submission' ~ '^[0-9]+$'
        THEN (a.old_value->>'project_streak_days_at_submission')::integer
      ELSE 0
    END AS previous_snapshot
  FROM audit_logs a
  WHERE a.entity_type = 'ship'
    AND a.action IN ('submit_project_for_review', 'resubmit_project_for_review')
    AND a.created_at >= TIMESTAMP '2026-08-17 10:21:00'
    AND a.entity_id ~ '^[0-9]+$'
    AND a.new_value->>'project_id' ~ '^[0-9]+$'
    AND a.new_value->>'project_streak_days_at_submission' ~ '^[0-9]+$'
  ORDER BY a.entity_id, a.created_at DESC, a.id DESC
)
SELECT
  e.ship_id,
  s.user_id,
  e.project_id,
  s.status,
  e.bad_snapshot AS old_snapshot,
  greatest(e.previous_snapshot, e.bad_snapshot - evidence.inflation) AS corrected_snapshot,
  e.bad_last_worked_snapshot AS old_last_worked_snapshot,
  CASE
    WHEN e.bad_last_worked_snapshot = evidence.bad_last_worked
      THEN evidence.expected_last_worked
    ELSE e.bad_last_worked_snapshot
  END AS corrected_last_worked_snapshot,
  evidence.inflation
FROM submission_events e
JOIN ships s ON s.id = e.ship_id AND s.project_id = e.project_id
JOIN LATERAL (
  SELECT a.*
  FROM cross_project_streak_audit_repairs a
  WHERE a.project_id = e.project_id
    AND a.created_at <= e.created_at
  ORDER BY a.created_at DESC, a.audit_id DESC
  LIMIT 1
) evidence ON true
WHERE s.status IN ('under_review', 'pending_fraud_review', 'needs_changes', 'pending_second_pass')
  AND s.project_streak_days_at_submission = e.bad_snapshot
  AND greatest(e.previous_snapshot, e.bad_snapshot - evidence.inflation) < e.bad_snapshot
  AND NOT EXISTS (
    SELECT 1
    FROM audit_logs prior
    WHERE prior.action = 'cross_project_ship_snapshot_repaired'
      AND prior.entity_type = 'ship'
      AND prior.entity_id = e.ship_id::text
  );

INSERT INTO audit_logs (
  actor_id, action, entity_type, entity_id, old_value, new_value, sensitive, change_summary
)
SELECT
  r.user_id,
  'cross_project_ship_snapshot_repaired',
  'ship',
  r.ship_id::text,
  jsonb_build_object(
    'project_streak_days_at_submission', r.old_snapshot,
    'project_last_worked_date_at_submission', r.old_last_worked_snapshot
  ),
  jsonb_build_object(
    'project_streak_days_at_submission', r.corrected_snapshot,
    'project_last_worked_date_at_submission', r.corrected_last_worked_snapshot,
    'removed_days', r.inflation
  ),
  false,
  'Lowered an unpaid ship snapshot using its submit/resubmit audit and the reproduced project delta.'
FROM cross_project_ship_repairs r;

UPDATE ships s
SET
  project_streak_days_at_submission = r.corrected_snapshot,
  project_last_worked_date_at_submission = r.corrected_last_worked_snapshot
FROM cross_project_ship_repairs r
WHERE s.id = r.ship_id;

INSERT INTO audit_logs (
  actor_id, action, entity_type, entity_id, old_value, new_value, sensitive, change_summary
)
SELECT
  r.user_id,
  'cross_project_pending_reward_requires_review',
  'ship',
  r.ship_id::text,
  jsonb_build_object(
    'status', s.status,
    'project_streak_days_at_submission', r.old_snapshot,
    'second_pass_multiplier', s.second_pass_multiplier,
    'second_pass_gold_reward', s.second_pass_gold_reward,
    'second_pass_lifetime_fruit_delta', s.second_pass_lifetime_fruit_delta,
    'second_pass_contributor_split', s.second_pass_contributor_split
  ),
  jsonb_build_object(
    'corrected_project_streak_days_at_submission', r.corrected_snapshot,
    'removed_days', r.inflation
  ),
  true,
  'Pending second-pass reward was frozen with an inflated streak and requires reward snapshot review before payout.'
FROM cross_project_ship_repairs r
JOIN ships s ON s.id = r.ship_id
WHERE r.status = 'pending_second_pass'
  AND NOT EXISTS (
    SELECT 1
    FROM audit_logs prior
    WHERE prior.action = 'cross_project_pending_reward_requires_review'
      AND prior.entity_type = 'ship'
      AND prior.entity_id = r.ship_id::text
  );

INSERT INTO audit_logs (
  actor_id, action, entity_type, entity_id, old_value, new_value, sensitive, change_summary
)
SELECT
  s.user_id,
  'cross_project_paid_ship_requires_ledger_review',
  'ship',
  s.id::text,
  jsonb_build_object(
    'project_streak_days_at_submission', s.project_streak_days_at_submission,
    'second_pass_multiplier', s.second_pass_multiplier,
    'second_pass_gold_reward', s.second_pass_gold_reward
  ),
  jsonb_build_object(
    'project_inflation_days', r.inflation,
    'bad_deploy_started_at', '2026-08-17T10:21:00Z'
  ),
  true,
  'A paid ship belongs to a repaired project; verify its exact ledger delta before any clawback.'
FROM ships s
JOIN cross_project_streak_repairs r ON r.project_id = s.project_id
WHERE s.status IN ('shipped', 'shipped_missing_airtable')
  AND s.reviewed_at >= TIMESTAMP '2026-08-17 10:21:00'
  AND NOT EXISTS (
    SELECT 1
    FROM audit_logs prior
    WHERE prior.action = 'cross_project_paid_ship_requires_ledger_review'
      AND prior.entity_type = 'ship'
      AND prior.entity_id = s.id::text
  );
