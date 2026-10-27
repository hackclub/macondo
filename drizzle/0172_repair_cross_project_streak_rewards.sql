LOCK TABLE
  audit_logs,
  daily_project_activity,
  streak_days,
  projects,
  project_collaborators,
  ships,
  project_grants,
  currency_transactions,
  ship_contributors,
  user_achievements,
  users
IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO users (id, name, email, is_system, is_temp, onboarding_step)
VALUES (
  'system-streak-repair',
  'streak repair (system)',
  'streak-repair@system.macondo.invalid',
  true,
  false,
  'complete'
)
ON CONFLICT (id) DO UPDATE
SET is_system = true, name = EXCLUDED.name;

CREATE TEMP TABLE cross_project_streak_reward_evidence ON COMMIT DROP AS
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

CREATE TEMP TABLE cross_project_corrected_ship_snapshots ON COMMIT DROP AS
WITH RECURSIVE submission_events AS (
  SELECT
    a.id AS audit_id,
    a.created_at,
    a.entity_id::integer AS ship_id,
    (a.new_value->>'project_id')::integer AS project_id,
    (a.new_value->>'project_streak_days_at_submission')::integer AS bad_snapshot,
    a.new_value->>'project_last_worked_date_at_submission' AS bad_last_worked_snapshot,
    row_number() OVER (
      PARTITION BY a.entity_id
      ORDER BY a.created_at, a.id
    ) AS event_number
  FROM audit_logs a
  WHERE a.entity_type = 'ship'
    AND a.action IN ('submit_project_for_review', 'resubmit_project_for_review')
    AND a.entity_id ~ '^[0-9]+$'
    AND a.new_value->>'project_id' ~ '^[0-9]+$'
    AND a.new_value->>'project_streak_days_at_submission' ~ '^[0-9]+$'
    AND EXISTS (
      SELECT 1
      FROM cross_project_streak_reward_evidence evidence
      WHERE evidence.project_id = (a.new_value->>'project_id')::integer
    )
), event_evidence AS (
  SELECT
    e.*,
    COALESCE(evidence.inflation, 0) AS inflation,
    evidence.bad_last_worked AS evidence_bad_last_worked,
    evidence.expected_last_worked AS evidence_expected_last_worked
  FROM submission_events e
  LEFT JOIN LATERAL (
    SELECT x.*
    FROM cross_project_streak_reward_evidence x
    WHERE x.project_id = e.project_id
      AND x.created_at <= e.created_at
    ORDER BY x.created_at DESC, x.audit_id DESC
    LIMIT 1
  ) evidence ON true
), snapshot_walk AS (
  SELECT
    e.ship_id,
    e.project_id,
    e.event_number,
    e.bad_snapshot,
    greatest(0, e.bad_snapshot - e.inflation) AS corrected_snapshot,
    e.bad_last_worked_snapshot,
    CASE
      WHEN e.bad_last_worked_snapshot = e.evidence_bad_last_worked
        THEN e.evidence_expected_last_worked
      ELSE e.bad_last_worked_snapshot
    END AS corrected_last_worked_snapshot
  FROM event_evidence e
  WHERE e.event_number = 1

  UNION ALL

  SELECT
    e.ship_id,
    e.project_id,
    e.event_number,
    e.bad_snapshot,
    greatest(w.corrected_snapshot, e.bad_snapshot - e.inflation) AS corrected_snapshot,
    e.bad_last_worked_snapshot,
    CASE
      WHEN e.bad_last_worked_snapshot = e.evidence_bad_last_worked
        THEN e.evidence_expected_last_worked
      ELSE e.bad_last_worked_snapshot
    END AS corrected_last_worked_snapshot
  FROM snapshot_walk w
  JOIN event_evidence e
    ON e.ship_id = w.ship_id
   AND e.event_number = w.event_number + 1
)
SELECT DISTINCT ON (ship_id)
  ship_id,
  project_id,
  bad_snapshot,
  corrected_snapshot,
  bad_last_worked_snapshot,
  corrected_last_worked_snapshot
FROM snapshot_walk
ORDER BY ship_id, event_number DESC;

CREATE TEMP TABLE cross_project_reward_candidates ON COMMIT DROP AS
WITH approval_ships AS (
  SELECT
    s.*,
    COALESCE(
      s.first_pass_approved_at,
      s.reviewed_at,
      (
        SELECT max(reward.created_at)
        FROM currency_transactions reward
        WHERE reward.ship_id = s.id
          AND reward.source = 'ship_reward'
      )
    ) AS approval_at,
    s.first_pass_approved_at IS NULL AS auto_approved
  FROM ships s
  WHERE (
      s.status = 'pending_second_pass'
      OR EXISTS (
        SELECT 1
        FROM currency_transactions reward
        WHERE reward.ship_id = s.id
          AND reward.source = 'ship_reward'
          AND reward.type = 'increase'
          AND reward.fruit_type IS NULL
          AND reward.counts = true
      )
      OR EXISTS (
        SELECT 1
        FROM audit_logs fraud
        WHERE fraud.entity_type = 'ship'
          AND fraud.entity_id = s.id::text
          AND fraud.action = 'fraud_flag_clawback'
      )
    )
    AND COALESCE(
      s.first_pass_approved_at,
      s.reviewed_at,
      (
        SELECT max(reward.created_at)
        FROM currency_transactions reward
        WHERE reward.ship_id = s.id
          AND reward.source = 'ship_reward'
      )
    ) >= TIMESTAMP '2026-08-17 10:21:00'
    AND NOT EXISTS (
      SELECT 1
      FROM audit_logs prior
      WHERE prior.action IN (
        'cross_project_streak_reward_repaired',
        'cross_project_streak_reward_repair_requires_manual_review'
      )
        AND prior.entity_type = 'ship'
        AND prior.entity_id = s.id::text
    )
), approval_context AS (
  SELECT
    s.*,
    evidence.inflation,
    verified_repair.verified_inflation,
    evidence.bad_last_worked AS evidence_bad_last_worked,
    evidence.expected_last_worked AS evidence_expected_last_worked,
    live_audit.bad_live_streak,
    live_audit.bad_live_last_worked,
    snapshot.bad_snapshot,
    snapshot.corrected_snapshot,
    snapshot.bad_last_worked_snapshot,
    snapshot.corrected_last_worked_snapshot,
    CASE lower(s.second_pass_assigned_fruit)
      WHEN 'mango' THEN 1 WHEN 'guava' THEN 1
      WHEN 'pineapple' THEN 2 WHEN 'coconut' THEN 2
      WHEN 'papaya' THEN 3 WHEN 'watermelon' THEN 3
      WHEN 'cocoa' THEN 4 WHEN 'avocado' THEN 4
      ELSE NULL
    END AS approval_level,
    auto_reward.auto_gold_reward,
    auto_reward.auto_multiplier,
    auto_reward.auto_streak_days,
    auto_reward.auto_reward_row_count
  FROM approval_ships s
  JOIN LATERAL (
    SELECT x.*
    FROM cross_project_streak_reward_evidence x
    WHERE x.project_id = s.project_id
      AND x.created_at <= s.approval_at
    ORDER BY x.created_at DESC, x.audit_id DESC
    LIMIT 1
  ) evidence ON true
  LEFT JOIN LATERAL (
    SELECT (repair.new_value->>'removed_days')::integer AS verified_inflation
    FROM audit_logs repair
    WHERE repair.entity_type = 'project'
      AND repair.entity_id = s.project_id::text
      AND repair.action = 'cross_project_streak_inflation_repaired'
      AND repair.new_value->>'removed_days' ~ '^[0-9]+$'
    ORDER BY repair.created_at DESC, repair.id DESC
    LIMIT 1
  ) verified_repair ON true
  JOIN LATERAL (
    SELECT
      (a.new_value->>'project_streak_days')::integer AS bad_live_streak,
      a.new_value->>'last_worked_date' AS bad_live_last_worked
    FROM audit_logs a
    WHERE a.entity_type = 'project'
      AND a.entity_id = s.project_id::text
      AND a.action = 'project_streak_extend'
      AND a.created_at <= s.approval_at
      AND a.new_value->>'project_streak_days' ~ '^[0-9]+$'
      AND a.new_value->>'last_worked_date' ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT 1
  ) live_audit ON true
  LEFT JOIN cross_project_corrected_ship_snapshots snapshot ON snapshot.ship_id = s.id
  LEFT JOIN LATERAL (
    SELECT
      sum(ct.amount)::integer AS auto_gold_reward,
      (substring(max(ct.memo) from '× ([0-9]+\.[0-9]+) project streak bonus'))::numeric AS auto_multiplier,
      (substring(max(ct.memo) from 'project streak bonus \(([0-9]+)d\)'))::integer AS auto_streak_days,
      count(*)::integer AS auto_reward_row_count
    FROM currency_transactions ct
    WHERE ct.ship_id = s.id
      AND ct.source = 'ship_reward'
      AND ct.type = 'increase'
      AND ct.fruit_type IS NULL
      AND ct.counts = true
  ) auto_reward ON s.auto_approved
), streak_inputs AS (
  SELECT
    c.*,
    greatest(c.bad_snapshot, c.bad_live_streak) AS bad_effective_streak,
    greatest(
      c.corrected_snapshot,
      greatest(0, c.bad_live_streak - c.inflation)
    ) AS corrected_effective_streak,
    CASE
      WHEN c.bad_live_last_worked = c.evidence_bad_last_worked
        THEN c.evidence_expected_last_worked
      ELSE c.bad_live_last_worked
    END AS corrected_live_last_worked,
    CASE c.approval_level
      WHEN 1 THEN 40 WHEN 2 THEN 45 WHEN 3 THEN 50 WHEN 4 THEN 60
    END::numeric AS gold_per_hour,
    CASE c.approval_level
      WHEN 1 THEN 8 WHEN 2 THEN 3 WHEN 3 THEN 2 WHEN 4 THEN 1
    END::numeric AS fruit_per_hour,
    CASE c.approval_level
      WHEN 1 THEN 100 WHEN 2 THEN 88 WHEN 3 THEN 70 WHEN 4 THEN 41
    END AS cap_days
  FROM approval_context c
), multiplier_inputs AS (
  SELECT
    i.*,
    CASE
      WHEN i.bad_effective_streak <= 0 THEN 1::numeric
      WHEN i.bad_live_last_worked IS NULL THEN 1 + i.bad_effective_streak * 0.01
      WHEN i.bad_live_last_worked::date - (i.bad_effective_streak - 1) >= DATE '2026-07-02'
        THEN 1 + least(i.bad_effective_streak, i.cap_days) * 0.01
      ELSE 1 + i.bad_effective_streak * 0.01
    END::numeric(10,2) AS reconstructed_bad_multiplier,
    CASE
      WHEN i.corrected_effective_streak <= 0 THEN 1::numeric
      WHEN i.corrected_live_last_worked IS NULL THEN 1 + i.corrected_effective_streak * 0.01
      WHEN i.corrected_live_last_worked::date - (i.corrected_effective_streak - 1) >= DATE '2026-07-02'
        THEN 1 + least(i.corrected_effective_streak, i.cap_days) * 0.01
      ELSE 1 + i.corrected_effective_streak * 0.01
    END::numeric(10,2) AS corrected_multiplier
  FROM streak_inputs i
), reward_inputs AS (
  SELECT
    m.*,
    CASE WHEN m.auto_approved THEN m.auto_multiplier ELSE m.second_pass_multiplier END AS old_multiplier,
    CASE WHEN m.auto_approved THEN m.auto_gold_reward ELSE m.second_pass_gold_reward END AS old_gold_reward,
    greatest(
      0::numeric,
      COALESCE(m.override_hours, 0)::numeric
        - CASE
            WHEN m.needs_funding THEN COALESCE(
              m.needs_funding_hours_override,
              m.needs_funding_hours,
              0
            )::numeric
            ELSE 0::numeric
          END
    ) AS reward_hours
  FROM multiplier_inputs m
)
SELECT
  r.*,
  floor(r.reward_hours * r.gold_per_hour * r.corrected_multiplier)::integer AS corrected_gold_reward,
  floor(r.reward_hours * r.fruit_per_hour * r.corrected_multiplier)::integer AS corrected_lifetime_fruit_delta,
  CASE
    WHEN r.auto_approved THEN jsonb_build_array(jsonb_build_object(
      'user_id', r.user_id,
      'amount', r.old_gold_reward,
      'hours', COALESCE(r.override_hours, 0)
    ))
    ELSE COALESCE(r.second_pass_contributor_split, '[]'::jsonb)
  END AS old_contributor_split
FROM reward_inputs r;

CREATE TEMP TABLE cross_project_valid_reward_repairs ON COMMIT DROP AS
SELECT c.*
FROM cross_project_reward_candidates c
WHERE c.approval_level IS NOT NULL
  AND c.bad_snapshot IS NOT NULL
  AND c.corrected_snapshot IS NOT NULL
  AND c.old_multiplier IS NOT NULL
  AND c.old_gold_reward IS NOT NULL
  AND c.second_pass_assigned_fruit IS NOT NULL
  AND c.verified_inflation = c.inflation
  AND c.corrected_multiplier < c.old_multiplier
  AND c.reconstructed_bad_multiplier = c.old_multiplier
  AND (
    NOT c.auto_approved
    OR (
      c.auto_reward_row_count = 1
      AND c.auto_streak_days = c.bad_effective_streak
    )
  )
  AND c.second_pass_lifetime_fruit_delta IS NOT NULL
  AND jsonb_typeof(c.old_contributor_split) = 'array'
  AND jsonb_array_length(c.old_contributor_split) = (
    SELECT count(DISTINCT entry.value->>'user_id')
    FROM jsonb_array_elements(c.old_contributor_split) entry(value)
  )
  AND COALESCE((
    SELECT sum((entry.value->>'amount')::numeric)
    FROM jsonb_array_elements(c.old_contributor_split) entry(value)
    WHERE entry.value->>'amount' ~ '^[0-9]+(\.[0-9]+)?$'
  ), 0) = c.old_gold_reward;

CREATE TEMP TABLE cross_project_corrected_reward_splits ON COMMIT DROP AS
WITH split_entries AS (
  SELECT
    r.id AS ship_id,
    entry.ordinality,
    entry.value->>'user_id' AS user_id,
    (entry.value->>'amount')::integer AS old_amount,
    (entry.value->>'hours')::numeric AS hours,
    r.corrected_gold_reward,
    count(*) OVER (PARTITION BY r.id) AS entry_count,
    sum((entry.value->>'hours')::numeric) OVER (PARTITION BY r.id) AS total_hours
  FROM cross_project_valid_reward_repairs r
  CROSS JOIN LATERAL jsonb_array_elements(r.old_contributor_split)
    WITH ORDINALITY AS entry(value, ordinality)
  WHERE entry.value->>'user_id' IS NOT NULL
    AND entry.value->>'amount' ~ '^[0-9]+$'
    AND entry.value->>'hours' ~ '^[0-9]+(\.[0-9]+)?$'
), allocations AS (
  SELECT
    e.*,
    CASE
      WHEN e.ordinality = e.entry_count THEN NULL
      WHEN e.total_hours > 0 THEN floor(e.corrected_gold_reward * e.hours / e.total_hours)::integer
      ELSE floor(e.corrected_gold_reward::numeric / e.entry_count)::integer
    END AS preliminary_amount
  FROM split_entries e
), residuals AS (
  SELECT
    a.*,
    COALESCE(sum(a.preliminary_amount) OVER (PARTITION BY a.ship_id), 0) AS allocated_before_last
  FROM allocations a
), corrected AS (
  SELECT
    r.*,
    CASE
      WHEN r.ordinality = r.entry_count
        THEN r.corrected_gold_reward - r.allocated_before_last
      ELSE r.preliminary_amount
    END AS corrected_amount
  FROM residuals r
)
SELECT
  c.ship_id,
  jsonb_agg(jsonb_build_object(
    'user_id', c.user_id,
    'amount', c.corrected_amount,
    'hours', c.hours
  ) ORDER BY c.ordinality) AS corrected_split
FROM corrected c
GROUP BY c.ship_id;

DELETE FROM cross_project_valid_reward_repairs r
WHERE NOT EXISTS (
  SELECT 1
  FROM cross_project_corrected_reward_splits split
  WHERE split.ship_id = r.id
);

SELECT pg_advisory_xact_lock(lock_row.project_id::bigint)
FROM (
  SELECT DISTINCT project_id
  FROM cross_project_valid_reward_repairs
  ORDER BY project_id
) lock_row;

SELECT pg_advisory_xact_lock(hashtext(lock_row.user_id)::bigint)
FROM (
  SELECT entry.value->>'user_id' AS user_id
  FROM cross_project_valid_reward_repairs repair
  CROSS JOIN LATERAL jsonb_array_elements(repair.old_contributor_split) entry(value)
  UNION
  SELECT user_id
  FROM cross_project_valid_reward_repairs
  ORDER BY user_id
) lock_row;

SELECT ship.id
FROM ships ship
JOIN cross_project_valid_reward_repairs repair ON repair.id = ship.id
ORDER BY ship.id
FOR UPDATE;

CREATE TEMP TABLE cross_project_pending_reward_repairs ON COMMIT DROP AS
WITH applied AS (
  UPDATE ships s
  SET
    project_streak_days_at_submission = r.corrected_snapshot,
    project_last_worked_date_at_submission = r.corrected_last_worked_snapshot,
    second_pass_multiplier = r.corrected_multiplier,
    second_pass_gold_reward = r.corrected_gold_reward,
    second_pass_lifetime_fruit_delta = r.corrected_lifetime_fruit_delta,
    second_pass_contributor_split = split.corrected_split
  FROM cross_project_valid_reward_repairs r
  JOIN cross_project_corrected_reward_splits split ON split.ship_id = r.id
  WHERE s.id = r.id
    AND s.status = 'pending_second_pass'
    AND s.project_streak_days_at_submission IS NOT DISTINCT FROM r.bad_snapshot
    AND s.project_last_worked_date_at_submission IS NOT DISTINCT FROM r.bad_last_worked_snapshot
    AND s.second_pass_assigned_fruit IS NOT DISTINCT FROM r.second_pass_assigned_fruit
    AND s.second_pass_multiplier = r.old_multiplier
    AND s.second_pass_gold_reward = r.old_gold_reward
    AND s.second_pass_lifetime_fruit_delta IS NOT DISTINCT FROM r.second_pass_lifetime_fruit_delta
    AND s.second_pass_contributor_split IS NOT DISTINCT FROM r.old_contributor_split
  RETURNING s.id
)
SELECT repair.*, split.corrected_split
FROM applied
JOIN cross_project_valid_reward_repairs repair ON repair.id = applied.id
JOIN cross_project_corrected_reward_splits split ON split.ship_id = applied.id;

INSERT INTO audit_logs (
  actor_id, action, entity_type, entity_id, old_value, new_value, sensitive, change_summary
)
SELECT
  'system-streak-repair',
  'cross_project_streak_reward_repaired',
  'ship',
  r.id::text,
  jsonb_build_object(
    'status', r.status,
    'project_streak_days_at_submission', r.bad_snapshot,
    'effective_streak_days', r.bad_effective_streak,
    'second_pass_multiplier', r.old_multiplier,
    'second_pass_gold_reward', r.old_gold_reward,
    'second_pass_lifetime_fruit_delta', r.second_pass_lifetime_fruit_delta,
    'second_pass_contributor_split', r.old_contributor_split
  ),
  jsonb_build_object(
    'project_streak_days_at_submission', r.corrected_snapshot,
    'effective_streak_days', r.corrected_effective_streak,
    'second_pass_multiplier', r.corrected_multiplier,
    'second_pass_gold_reward', r.corrected_gold_reward,
    'second_pass_lifetime_fruit_delta', r.corrected_lifetime_fruit_delta,
    'second_pass_contributor_split', r.corrected_split,
    'inflation_days', r.inflation,
    'payout_state', 'pending_second_pass'
  ),
  true,
  'Corrected a pending reward snapshot before payout using approval-time streak evidence.'
FROM cross_project_pending_reward_repairs r;

CREATE TEMP TABLE cross_project_paid_reward_repairs ON COMMIT DROP AS
WITH paid AS (
  SELECT r.*, split.corrected_split
  FROM cross_project_valid_reward_repairs r
  JOIN cross_project_corrected_reward_splits split ON split.ship_id = r.id
  WHERE r.status <> 'pending_second_pass'
), expected_rows AS (
  SELECT
    p.id AS ship_id,
    entry.value->>'user_id' AS user_id,
    (entry.value->>'amount')::integer AS old_amount,
    (corrected.value->>'amount')::integer AS corrected_amount
  FROM paid p
  CROSS JOIN LATERAL jsonb_array_elements(p.old_contributor_split)
    WITH ORDINALITY AS entry(value, ordinality)
  CROSS JOIN LATERAL jsonb_array_elements(p.corrected_split)
    WITH ORDINALITY AS corrected(value, ordinality)
  WHERE entry.ordinality = corrected.ordinality
), ledger_rows AS (
  SELECT
    e.*,
    ct.id AS transaction_id,
    ct.unlocked_at,
    ct.pending_for_project_id,
    ct.pending_for_ship_id,
    ct.priority,
    count(ct.id) OVER (PARTITION BY e.ship_id, e.user_id) AS matching_rows
  FROM expected_rows e
  LEFT JOIN currency_transactions ct
    ON ct.ship_id = e.ship_id
   AND ct.user_id = e.user_id
   AND ct.source = 'ship_reward'
   AND ct.type = 'increase'
   AND ct.fruit_type IS NULL
   AND ct.counts = true
   AND ct.amount = e.old_amount
), user_balances AS (
  SELECT
    ct.user_id,
    COALESCE(sum(CASE WHEN ct.type = 'increase' THEN ct.amount ELSE -ct.amount END), 0) AS balance,
    COALESCE(sum(CASE
      WHEN ct.priority THEN CASE WHEN ct.type = 'increase' THEN ct.amount ELSE -ct.amount END
      ELSE 0
    END), 0) AS priority_balance,
    COALESCE(sum(CASE
      WHEN NOT ct.priority THEN CASE WHEN ct.type = 'increase' THEN ct.amount ELSE -ct.amount END
      ELSE 0
    END), 0) AS non_priority_balance
  FROM currency_transactions ct
  WHERE ct.counts = true
    AND ct.fruit_type IS NULL
    AND ct.unlocked_at IS NOT NULL
  GROUP BY ct.user_id
), required_balance_corrections AS (
  SELECT
    l.user_id,
    sum(l.old_amount - l.corrected_amount) FILTER (
      WHERE l.unlocked_at IS NOT NULL
    ) AS balance_delta,
    sum(l.old_amount - l.corrected_amount) FILTER (
      WHERE l.unlocked_at IS NOT NULL AND l.priority
    ) AS priority_delta,
    sum(l.old_amount - l.corrected_amount) FILTER (
      WHERE l.unlocked_at IS NOT NULL AND NOT l.priority
    ) AS non_priority_delta
  FROM ledger_rows l
  GROUP BY l.user_id
), safe_users AS (
  SELECT required.user_id
  FROM required_balance_corrections required
  LEFT JOIN user_balances balance ON balance.user_id = required.user_id
  WHERE COALESCE(balance.balance, 0) >= COALESCE(required.balance_delta, 0)
    AND COALESCE(balance.priority_balance, 0) >= COALESCE(required.priority_delta, 0)
    AND COALESCE(balance.non_priority_balance, 0) >= COALESCE(required.non_priority_delta, 0)
), required_fruit_corrections AS (
  SELECT
    p.user_id,
    p.second_pass_assigned_fruit AS fruit,
    sum(p.second_pass_lifetime_fruit_delta - p.corrected_lifetime_fruit_delta) AS delta
  FROM paid p
  GROUP BY p.user_id, p.second_pass_assigned_fruit
), safe_ships AS (
  SELECT l.ship_id
  FROM ledger_rows l
  JOIN safe_users safe_user ON safe_user.user_id = l.user_id
  GROUP BY l.ship_id
  HAVING bool_and(l.old_amount = 0 OR (l.transaction_id IS NOT NULL AND l.matching_rows = 1))
    AND bool_and((
      SELECT count(*)
      FROM ship_contributors contributor
      WHERE contributor.ship_id = l.ship_id
        AND contributor.user_id = l.user_id
    ) = 1)
)
SELECT p.*
FROM paid p
JOIN safe_ships safe ON safe.ship_id = p.id
WHERE COALESCE(
  (SELECT (u.lifetime_fruits_earned->>p.second_pass_assigned_fruit)::numeric FROM users u WHERE u.id = p.user_id),
  0
) >= (
  SELECT required.delta
  FROM required_fruit_corrections required
  WHERE required.user_id = p.user_id
    AND required.fruit = p.second_pass_assigned_fruit
);

CREATE TEMP TABLE cross_project_paid_reward_ledger_rows ON COMMIT DROP AS
SELECT
  r.id AS ship_id,
  entry.value->>'user_id' AS user_id,
  (entry.value->>'amount')::integer AS old_amount,
  (corrected.value->>'amount')::integer AS corrected_amount,
  ct.id AS transaction_id,
  ct.unlocked_at,
  ct.priority
FROM cross_project_paid_reward_repairs r
CROSS JOIN LATERAL jsonb_array_elements(r.old_contributor_split)
  WITH ORDINALITY AS entry(value, ordinality)
CROSS JOIN LATERAL jsonb_array_elements(r.corrected_split)
  WITH ORDINALITY AS corrected(value, ordinality)
JOIN currency_transactions ct
  ON ct.ship_id = r.id
 AND ct.user_id = entry.value->>'user_id'
 AND ct.source = 'ship_reward'
 AND ct.type = 'increase'
 AND ct.fruit_type IS NULL
 AND ct.counts = true
 AND ct.amount = (entry.value->>'amount')::numeric
WHERE entry.ordinality = corrected.ordinality
  AND (entry.value->>'amount')::integer > (corrected.value->>'amount')::integer;

UPDATE currency_transactions ct
SET
  amount = rows.corrected_amount,
  memo = concat(ct.memo, ' [cross-project streak inflation corrected]')
FROM cross_project_paid_reward_ledger_rows rows
WHERE ct.id = rows.transaction_id
  AND ct.amount = rows.old_amount;

WITH fruit_deltas AS (
  SELECT
    r.user_id,
    r.second_pass_assigned_fruit AS fruit,
    sum(r.second_pass_lifetime_fruit_delta - r.corrected_lifetime_fruit_delta) AS delta
  FROM cross_project_paid_reward_repairs r
  GROUP BY r.user_id, r.second_pass_assigned_fruit
), corrected_fruits AS (
  SELECT
    u.id AS user_id,
    jsonb_object_agg(
      d.fruit,
      to_jsonb(greatest(
        0,
        COALESCE((u.lifetime_fruits_earned->>d.fruit)::numeric, 0) - d.delta
      ))
    ) AS values
  FROM users u
  JOIN fruit_deltas d ON d.user_id = u.id
  GROUP BY u.id, u.lifetime_fruits_earned
)
UPDATE users u
SET lifetime_fruits_earned = COALESCE(u.lifetime_fruits_earned, '{}'::jsonb) || corrected.values
FROM corrected_fruits corrected
WHERE u.id = corrected.user_id;

UPDATE ship_contributors contributor
SET fruit_awarded = (entry.value->>'amount')::numeric
FROM cross_project_paid_reward_repairs r
CROSS JOIN LATERAL jsonb_array_elements(r.corrected_split) entry(value)
WHERE contributor.ship_id = r.id
  AND contributor.user_id = entry.value->>'user_id';

UPDATE ships s
SET
  project_streak_days_at_submission = r.corrected_snapshot,
  project_last_worked_date_at_submission = r.corrected_last_worked_snapshot,
  second_pass_multiplier = CASE WHEN r.auto_approved THEN s.second_pass_multiplier ELSE r.corrected_multiplier END,
  second_pass_gold_reward = CASE WHEN r.auto_approved THEN s.second_pass_gold_reward ELSE r.corrected_gold_reward END,
  second_pass_lifetime_fruit_delta = r.corrected_lifetime_fruit_delta,
  second_pass_contributor_split = CASE WHEN r.auto_approved THEN s.second_pass_contributor_split ELSE r.corrected_split END
FROM cross_project_paid_reward_repairs r
WHERE s.id = r.id;

INSERT INTO audit_logs (
  actor_id, action, entity_type, entity_id, old_value, new_value, sensitive, change_summary
)
SELECT
  'system-streak-repair',
  'cross_project_streak_reward_repaired',
  'ship',
  r.id::text,
  jsonb_build_object(
    'status', r.status,
    'project_streak_days_at_submission', r.bad_snapshot,
    'effective_streak_days', r.bad_effective_streak,
    'multiplier', r.old_multiplier,
    'gold_reward', r.old_gold_reward,
    'lifetime_fruit_delta', r.second_pass_lifetime_fruit_delta,
    'contributor_split', r.old_contributor_split
  ),
  jsonb_build_object(
    'project_streak_days_at_submission', r.corrected_snapshot,
    'effective_streak_days', r.corrected_effective_streak,
    'multiplier', r.corrected_multiplier,
    'gold_reward', r.corrected_gold_reward,
    'lifetime_fruit_delta', r.corrected_lifetime_fruit_delta,
    'contributor_split', r.corrected_split,
    'inflation_days', r.inflation,
    'payout_state', 'paid',
    'ledger_transaction_ids', COALESCE((
      SELECT jsonb_agg(rows.transaction_id ORDER BY rows.transaction_id)
      FROM cross_project_paid_reward_ledger_rows rows
      WHERE rows.ship_id = r.id
    ), '[]'::jsonb)
  ),
  true,
  'Corrected an inflated paid reward after exact multiplier, split, ledger, balance, and lifetime-counter reconciliation.'
FROM cross_project_paid_reward_repairs r;

CREATE TEMP TABLE cross_project_fraud_reward_repairs ON COMMIT DROP AS
WITH fraud_candidates AS (
  SELECT repair.*, split.corrected_split
  FROM cross_project_valid_reward_repairs repair
  JOIN cross_project_corrected_reward_splits split ON split.ship_id = repair.id
  WHERE NOT EXISTS (
      SELECT 1
      FROM cross_project_paid_reward_repairs paid
      WHERE paid.id = repair.id
    )
    AND EXISTS (
      SELECT 1
      FROM audit_logs fraud
      WHERE fraud.entity_type = 'ship'
        AND fraud.entity_id = repair.id::text
        AND fraud.action = 'fraud_flag_clawback'
    )
), expected_rows AS (
  SELECT
    candidate.id AS ship_id,
    candidate.user_id AS owner_id,
    entry.value->>'user_id' AS user_id,
    (entry.value->>'amount')::integer AS old_amount,
    (corrected.value->>'amount')::integer AS corrected_amount
  FROM fraud_candidates candidate
  CROSS JOIN LATERAL jsonb_array_elements(candidate.old_contributor_split)
    WITH ORDINALITY AS entry(value, ordinality)
  CROSS JOIN LATERAL jsonb_array_elements(candidate.corrected_split)
    WITH ORDINALITY AS corrected(value, ordinality)
  WHERE entry.ordinality = corrected.ordinality
), ledger_rows AS (
  SELECT
    expected.*,
    reward.id AS transaction_id,
    reward.counts,
    reward.unlocked_at,
    reward.priority,
    count(reward.id) OVER (
      PARTITION BY expected.ship_id, expected.user_id
    ) AS matching_rows
  FROM expected_rows expected
  LEFT JOIN currency_transactions reward
    ON reward.ship_id = expected.ship_id
   AND reward.user_id = expected.user_id
   AND reward.source = 'ship_reward'
   AND reward.type = 'increase'
   AND reward.fruit_type IS NULL
   AND reward.amount = expected.old_amount
), disabled_owner_rows AS (
  SELECT DISTINCT ledger.ship_id, ledger.transaction_id
  FROM ledger_rows ledger
  JOIN audit_logs fraud
    ON fraud.entity_type = 'ship'
   AND fraud.entity_id = ledger.ship_id::text
   AND fraud.action = 'fraud_flag_clawback'
  CROSS JOIN LATERAL jsonb_array_elements_text(
    COALESCE(fraud.new_value->'disabled_reward_tx_ids', '[]'::jsonb)
  ) disabled(transaction_id)
  WHERE ledger.user_id = ledger.owner_id
    AND ledger.transaction_id = disabled.transaction_id::integer
    AND ledger.counts = false
), balances AS (
  SELECT
    transaction.user_id,
    sum(CASE WHEN transaction.type = 'increase' THEN transaction.amount ELSE -transaction.amount END) AS balance,
    sum(CASE
      WHEN transaction.priority
        THEN CASE WHEN transaction.type = 'increase' THEN transaction.amount ELSE -transaction.amount END
      ELSE 0
    END) AS priority_balance,
    sum(CASE
      WHEN NOT transaction.priority
        THEN CASE WHEN transaction.type = 'increase' THEN transaction.amount ELSE -transaction.amount END
      ELSE 0
    END) AS non_priority_balance
  FROM currency_transactions transaction
  WHERE transaction.counts = true
    AND transaction.fruit_type IS NULL
    AND transaction.unlocked_at IS NOT NULL
  GROUP BY transaction.user_id
), required_balance AS (
  SELECT
    ledger.user_id,
    sum(ledger.old_amount - ledger.corrected_amount) FILTER (
      WHERE ledger.counts AND ledger.unlocked_at IS NOT NULL
    ) AS balance_delta,
    sum(ledger.old_amount - ledger.corrected_amount) FILTER (
      WHERE ledger.counts AND ledger.unlocked_at IS NOT NULL AND ledger.priority
    ) AS priority_delta,
    sum(ledger.old_amount - ledger.corrected_amount) FILTER (
      WHERE ledger.counts AND ledger.unlocked_at IS NOT NULL AND NOT ledger.priority
    ) AS non_priority_delta
  FROM ledger_rows ledger
  GROUP BY ledger.user_id
), safe_users AS (
  SELECT required.user_id
  FROM required_balance required
  LEFT JOIN balances balance ON balance.user_id = required.user_id
  WHERE COALESCE(balance.balance, 0) >= COALESCE(required.balance_delta, 0)
    AND COALESCE(balance.priority_balance, 0) >= COALESCE(required.priority_delta, 0)
    AND COALESCE(balance.non_priority_balance, 0) >= COALESCE(required.non_priority_delta, 0)
), safe_ships AS (
  SELECT ledger.ship_id
  FROM ledger_rows ledger
  JOIN safe_users safe_user ON safe_user.user_id = ledger.user_id
  GROUP BY ledger.ship_id
  HAVING bool_and(
      ledger.old_amount = 0
      OR (ledger.transaction_id IS NOT NULL AND ledger.matching_rows = 1)
    )
    AND bool_and(
      ledger.user_id <> ledger.owner_id
      OR EXISTS (
        SELECT 1
        FROM disabled_owner_rows disabled
        WHERE disabled.ship_id = ledger.ship_id
          AND disabled.transaction_id = ledger.transaction_id
      )
    )
    AND bool_and((
      SELECT count(*)
      FROM ship_contributors contributor
      WHERE contributor.ship_id = ledger.ship_id
        AND contributor.user_id = ledger.user_id
    ) = 1)
), required_fruit AS (
  SELECT
    candidate.user_id,
    candidate.second_pass_assigned_fruit AS fruit,
    sum(
      candidate.second_pass_lifetime_fruit_delta
        - candidate.corrected_lifetime_fruit_delta
    ) AS delta
  FROM fraud_candidates candidate
  GROUP BY candidate.user_id, candidate.second_pass_assigned_fruit
)
SELECT candidate.*
FROM fraud_candidates candidate
JOIN safe_ships safe ON safe.ship_id = candidate.id
WHERE COALESCE((
    SELECT (owner.lifetime_fruits_earned->>candidate.second_pass_assigned_fruit)::numeric
    FROM users owner
    WHERE owner.id = candidate.user_id
  ), 0) >= (
    SELECT required.delta
    FROM required_fruit required
    WHERE required.user_id = candidate.user_id
      AND required.fruit = candidate.second_pass_assigned_fruit
  );

UPDATE currency_transactions reward
SET
  amount = corrected.corrected_amount,
  memo = concat(reward.memo, ' [cross-project streak inflation corrected]')
FROM (
  SELECT
    repair.id AS ship_id,
    entry.value->>'user_id' AS user_id,
    (entry.value->>'amount')::integer AS old_amount,
    (updated.value->>'amount')::integer AS corrected_amount
  FROM cross_project_fraud_reward_repairs repair
  CROSS JOIN LATERAL jsonb_array_elements(repair.old_contributor_split)
    WITH ORDINALITY AS entry(value, ordinality)
  CROSS JOIN LATERAL jsonb_array_elements(repair.corrected_split)
    WITH ORDINALITY AS updated(value, ordinality)
  WHERE entry.ordinality = updated.ordinality
) corrected
WHERE reward.ship_id = corrected.ship_id
  AND reward.user_id = corrected.user_id
  AND reward.source = 'ship_reward'
  AND reward.type = 'increase'
  AND reward.fruit_type IS NULL
  AND reward.amount = corrected.old_amount;

WITH fruit_deltas AS (
  SELECT
    repair.user_id,
    repair.second_pass_assigned_fruit AS fruit,
    sum(
      repair.second_pass_lifetime_fruit_delta
        - repair.corrected_lifetime_fruit_delta
    ) AS delta
  FROM cross_project_fraud_reward_repairs repair
  GROUP BY repair.user_id, repair.second_pass_assigned_fruit
), corrected_fruits AS (
  SELECT
    owner.id AS user_id,
    jsonb_object_agg(
      delta.fruit,
      to_jsonb(greatest(
        0,
        COALESCE((owner.lifetime_fruits_earned->>delta.fruit)::numeric, 0)
          - delta.delta
      ))
    ) AS values
  FROM users owner
  JOIN fruit_deltas delta ON delta.user_id = owner.id
  GROUP BY owner.id, owner.lifetime_fruits_earned
)
UPDATE users owner
SET lifetime_fruits_earned =
  COALESCE(owner.lifetime_fruits_earned, '{}'::jsonb) || corrected.values
FROM corrected_fruits corrected
WHERE owner.id = corrected.user_id;

UPDATE ship_contributors contributor
SET fruit_awarded = (entry.value->>'amount')::numeric
FROM cross_project_fraud_reward_repairs repair
CROSS JOIN LATERAL jsonb_array_elements(repair.corrected_split) entry(value)
WHERE contributor.ship_id = repair.id
  AND contributor.user_id = entry.value->>'user_id';

UPDATE ships ship
SET
  project_streak_days_at_submission = repair.corrected_snapshot,
  project_last_worked_date_at_submission = repair.corrected_last_worked_snapshot,
  second_pass_multiplier = CASE
    WHEN repair.auto_approved THEN ship.second_pass_multiplier
    ELSE repair.corrected_multiplier
  END,
  second_pass_gold_reward = CASE
    WHEN repair.auto_approved THEN ship.second_pass_gold_reward
    ELSE repair.corrected_gold_reward
  END,
  second_pass_lifetime_fruit_delta = repair.corrected_lifetime_fruit_delta,
  second_pass_contributor_split = CASE
    WHEN repair.auto_approved THEN ship.second_pass_contributor_split
    ELSE repair.corrected_split
  END
FROM cross_project_fraud_reward_repairs repair
WHERE ship.id = repair.id;

INSERT INTO audit_logs (
  actor_id, action, entity_type, entity_id, old_value, new_value, sensitive, change_summary
)
SELECT
  'system-streak-repair',
  'cross_project_streak_reward_repaired',
  'ship',
  repair.id::text,
  jsonb_build_object(
    'status', repair.status,
    'effective_streak_days', repair.bad_effective_streak,
    'multiplier', repair.old_multiplier,
    'gold_reward', repair.old_gold_reward,
    'lifetime_fruit_delta', repair.second_pass_lifetime_fruit_delta,
    'contributor_split', repair.old_contributor_split
  ),
  jsonb_build_object(
    'effective_streak_days', repair.corrected_effective_streak,
    'multiplier', repair.corrected_multiplier,
    'gold_reward', repair.corrected_gold_reward,
    'lifetime_fruit_delta', repair.corrected_lifetime_fruit_delta,
    'contributor_split', repair.corrected_split,
    'inflation_days', repair.inflation,
    'payout_state', 'fraud_clawed_back'
  ),
  true,
  'Corrected lifetime fruit, contributor state, and surviving collaborator rewards after a fraud clawback.'
FROM cross_project_fraud_reward_repairs repair;

CREATE TEMP TABLE cross_project_grant_fallback_candidates ON COMMIT DROP AS
WITH context AS (
  SELECT
    grant_row.id AS grant_id,
    grant_row.project_id,
    grant_row.ship_id,
    grant_row.user_id,
    project.type AS project_type,
    reward.id AS transaction_id,
    reward.amount::integer AS old_gold_reward,
    reward.counts,
    reward.unlocked_at,
    reward.created_at AS awarded_at,
    ship.override_hours::numeric AS approved_hours,
    snapshot.bad_snapshot,
    snapshot.corrected_snapshot,
    snapshot.corrected_last_worked_snapshot,
    evidence.inflation,
    evidence.bad_last_worked AS evidence_bad_last_worked,
    evidence.expected_last_worked AS evidence_expected_last_worked,
    verified.verified_inflation,
    live.bad_live_streak,
    live.bad_live_last_worked
  FROM project_grants grant_row
  JOIN projects project ON project.id = grant_row.project_id
  JOIN currency_transactions reward ON reward.id = grant_row.cancel_fruit_tx_id
  JOIN ships ship ON ship.id = grant_row.ship_id
  JOIN cross_project_corrected_ship_snapshots snapshot ON snapshot.ship_id = ship.id
  JOIN LATERAL (
    SELECT repair.*
    FROM cross_project_streak_reward_evidence repair
    WHERE repair.project_id = grant_row.project_id
      AND repair.created_at <= reward.created_at
    ORDER BY repair.created_at DESC, repair.audit_id DESC
    LIMIT 1
  ) evidence ON true
  LEFT JOIN LATERAL (
    SELECT (repair.new_value->>'removed_days')::integer AS verified_inflation
    FROM audit_logs repair
    WHERE repair.entity_type = 'project'
      AND repair.entity_id = grant_row.project_id::text
      AND repair.action = 'cross_project_streak_inflation_repaired'
      AND repair.new_value->>'removed_days' ~ '^[0-9]+$'
    ORDER BY repair.created_at DESC, repair.id DESC
    LIMIT 1
  ) verified ON true
  JOIN LATERAL (
    SELECT
      (audit.new_value->>'project_streak_days')::integer AS bad_live_streak,
      audit.new_value->>'last_worked_date' AS bad_live_last_worked
    FROM audit_logs audit
    WHERE audit.entity_type = 'project'
      AND audit.entity_id = grant_row.project_id::text
      AND audit.action = 'project_streak_extend'
      AND audit.created_at <= reward.created_at
      AND audit.new_value->>'project_streak_days' ~ '^[0-9]+$'
      AND audit.new_value->>'last_worked_date' ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
    ORDER BY audit.created_at DESC, audit.id DESC
    LIMIT 1
  ) live ON true
  WHERE reward.source = 'staff_reward'
    AND reward.type = 'increase'
    AND reward.fruit_type IS NULL
    AND reward.created_at >= TIMESTAMP '2026-08-17 10:21:00'
    AND evidence.inflation = verified.verified_inflation
    AND NOT EXISTS (
      SELECT 1
      FROM audit_logs prior
      WHERE prior.entity_type = 'project_grant'
        AND prior.entity_id = grant_row.id::text
        AND prior.action IN (
          'cross_project_grant_fallback_repaired',
          'cross_project_grant_fallback_requires_manual_review'
        )
    )
), streaks AS (
  SELECT
    context.*,
    greatest(context.bad_snapshot, context.bad_live_streak) AS bad_effective_streak,
    greatest(
      context.corrected_snapshot,
      greatest(0, context.bad_live_streak - context.inflation)
    ) AS corrected_effective_streak
  FROM context
), matching_levels AS (
  SELECT
    streaks.*,
    level.level,
    level.gold_per_hour,
    level.fruit_per_hour,
    CASE
      WHEN streaks.project_type = 'hardware' THEN
        CASE level.level
          WHEN 1 THEN 'Guava'
          WHEN 2 THEN 'Coconut'
          WHEN 3 THEN 'Watermelon'
          WHEN 4 THEN 'Avocado'
        END
      ELSE
        CASE level.level
          WHEN 1 THEN 'Mango'
          WHEN 2 THEN 'Pineapple'
          WHEN 3 THEN 'Papaya'
          WHEN 4 THEN 'Cocoa'
        END
    END AS fruit,
    count(*) OVER (PARTITION BY streaks.grant_id) AS matching_level_count
  FROM streaks
  CROSS JOIN LATERAL (
    VALUES
      (1, 40::numeric, 8::numeric),
      (2, 45::numeric, 3::numeric),
      (3, 50::numeric, 2::numeric),
      (4, 60::numeric, 1::numeric)
  ) level(level, gold_per_hour, fruit_per_hour)
  WHERE floor(
    streaks.approved_hours
      * level.gold_per_hour
      * (1 + streaks.bad_effective_streak * 0.01)
  )::integer = streaks.old_gold_reward
)
SELECT
  match.*,
  floor(
    match.approved_hours
      * match.gold_per_hour
      * (1 + match.corrected_effective_streak * 0.01)
  )::integer AS corrected_gold_reward,
  floor(
    match.approved_hours
      * match.fruit_per_hour
      * (1 + match.bad_effective_streak * 0.01)
  )::integer AS old_lifetime_fruit_delta,
  floor(
    match.approved_hours
      * match.fruit_per_hour
      * (1 + match.corrected_effective_streak * 0.01)
  )::integer AS corrected_lifetime_fruit_delta
FROM matching_levels match
WHERE match.matching_level_count = 1;

CREATE TEMP TABLE cross_project_grant_fallback_repairs ON COMMIT DROP AS
WITH balances AS (
  SELECT
    transaction.user_id,
    sum(CASE WHEN transaction.type = 'increase' THEN transaction.amount ELSE -transaction.amount END) AS balance
  FROM currency_transactions transaction
  WHERE transaction.counts = true
    AND transaction.fruit_type IS NULL
    AND transaction.unlocked_at IS NOT NULL
    AND transaction.priority = false
  GROUP BY transaction.user_id
), required AS (
  SELECT
    candidate.user_id,
    candidate.fruit,
    sum(candidate.old_gold_reward - candidate.corrected_gold_reward) FILTER (
      WHERE candidate.counts AND candidate.unlocked_at IS NOT NULL
    ) AS gold_delta,
    sum(
      candidate.old_lifetime_fruit_delta
        - candidate.corrected_lifetime_fruit_delta
    ) AS fruit_delta
  FROM cross_project_grant_fallback_candidates candidate
  GROUP BY candidate.user_id, candidate.fruit
)
SELECT candidate.*
FROM cross_project_grant_fallback_candidates candidate
JOIN required
  ON required.user_id = candidate.user_id
 AND required.fruit = candidate.fruit
LEFT JOIN balances balance ON balance.user_id = candidate.user_id
JOIN users owner ON owner.id = candidate.user_id
WHERE candidate.corrected_gold_reward <= candidate.old_gold_reward
  AND COALESCE(balance.balance, 0) >= COALESCE(required.gold_delta, 0)
  AND COALESCE((owner.lifetime_fruits_earned->>candidate.fruit)::numeric, 0)
    >= required.fruit_delta;

UPDATE currency_transactions reward
SET
  amount = repair.corrected_gold_reward,
  memo = concat(reward.memo, ' [cross-project streak inflation corrected]')
FROM cross_project_grant_fallback_repairs repair
WHERE reward.id = repair.transaction_id
  AND reward.amount = repair.old_gold_reward;

WITH fruit_deltas AS (
  SELECT
    repair.user_id,
    repair.fruit,
    sum(
      repair.old_lifetime_fruit_delta
        - repair.corrected_lifetime_fruit_delta
    ) AS delta
  FROM cross_project_grant_fallback_repairs repair
  GROUP BY repair.user_id, repair.fruit
), corrected_fruits AS (
  SELECT
    owner.id AS user_id,
    jsonb_object_agg(
      delta.fruit,
      to_jsonb(greatest(
        0,
        COALESCE((owner.lifetime_fruits_earned->>delta.fruit)::numeric, 0)
          - delta.delta
      ))
    ) AS values
  FROM users owner
  JOIN fruit_deltas delta ON delta.user_id = owner.id
  GROUP BY owner.id, owner.lifetime_fruits_earned
)
UPDATE users owner
SET lifetime_fruits_earned =
  COALESCE(owner.lifetime_fruits_earned, '{}'::jsonb) || corrected.values
FROM corrected_fruits corrected
WHERE owner.id = corrected.user_id;

UPDATE ships ship
SET
  project_streak_days_at_submission = repair.corrected_snapshot,
  project_last_worked_date_at_submission = repair.corrected_last_worked_snapshot
FROM cross_project_grant_fallback_repairs repair
WHERE ship.id = repair.ship_id;

INSERT INTO audit_logs (
  actor_id, action, entity_type, entity_id, old_value, new_value, sensitive, change_summary
)
SELECT
  'system-streak-repair',
  'cross_project_grant_fallback_repaired',
  'project_grant',
  repair.grant_id::text,
  jsonb_build_object(
    'transaction_id', repair.transaction_id,
    'gold_reward', repair.old_gold_reward,
    'lifetime_fruit_delta', repair.old_lifetime_fruit_delta,
    'effective_streak_days', repair.bad_effective_streak
  ),
  jsonb_build_object(
    'transaction_id', repair.transaction_id,
    'gold_reward', repair.corrected_gold_reward,
    'lifetime_fruit_delta', repair.corrected_lifetime_fruit_delta,
    'lifetime_fruit', repair.fruit,
    'effective_streak_days', repair.corrected_effective_streak,
    'inflation_days', repair.inflation
  ),
  true,
  'Corrected an inflated cancelled-grant fallback reward using its linked ledger row.'
FROM cross_project_grant_fallback_repairs repair;

INSERT INTO audit_logs (
  actor_id, action, entity_type, entity_id, old_value, new_value, sensitive, change_summary
)
SELECT
  'system-streak-repair',
  'cross_project_grant_fallback_requires_manual_review',
  'project_grant',
  candidate.grant_id::text,
  jsonb_build_object(
    'transaction_id', candidate.transaction_id,
    'gold_reward', candidate.old_gold_reward,
    'effective_streak_days', candidate.bad_effective_streak,
    'inflation_days', candidate.inflation
  ),
  jsonb_build_object(
    'reason', 'ledger_balance_or_lifetime_counter_did_not_reconcile',
    'automatic_clawback_applied', false
  ),
  true,
  'Affected cancelled-grant fallback failed exact automatic-repair guards.'
FROM cross_project_grant_fallback_candidates candidate
WHERE NOT EXISTS (
    SELECT 1
    FROM cross_project_grant_fallback_repairs repair
    WHERE repair.grant_id = candidate.grant_id
  );

INSERT INTO audit_logs (
  actor_id, action, entity_type, entity_id, old_value, new_value, sensitive, change_summary
)
SELECT DISTINCT
  'system-streak-repair',
  'cross_project_grant_fallback_requires_manual_review',
  'project_grant',
  grant_row.id::text,
  jsonb_build_object(
    'transaction_id', reward.id,
    'gold_reward', reward.amount,
    'ship_id', grant_row.ship_id,
    'project_id', grant_row.project_id
  ),
  jsonb_build_object(
    'reason', 'historical_level_or_streak_context_did_not_reconcile',
    'automatic_clawback_applied', false
  ),
  true,
  'Affected cancelled-grant fallback could not be reconstructed exactly.'
FROM project_grants grant_row
JOIN currency_transactions reward ON reward.id = grant_row.cancel_fruit_tx_id
WHERE reward.source = 'staff_reward'
  AND reward.type = 'increase'
  AND reward.fruit_type IS NULL
  AND reward.created_at >= TIMESTAMP '2026-08-17 10:21:00'
  AND EXISTS (
    SELECT 1
    FROM cross_project_streak_reward_evidence evidence
    WHERE evidence.project_id = grant_row.project_id
      AND evidence.created_at <= reward.created_at
  )
  AND NOT EXISTS (
    SELECT 1
    FROM audit_logs prior
    WHERE prior.entity_type = 'project_grant'
      AND prior.entity_id = grant_row.id::text
      AND prior.action IN (
        'cross_project_grant_fallback_repaired',
        'cross_project_grant_fallback_requires_manual_review'
      )
  );

INSERT INTO audit_logs (
  actor_id, action, entity_type, entity_id, old_value, new_value, sensitive, change_summary
)
SELECT DISTINCT
  'system-streak-repair',
  'cross_project_reversed_grant_fallback_requires_manual_review',
  'currency_transaction',
  reward.id::text,
  jsonb_build_object(
    'ship_id', reward.ship_id,
    'gold_reward', reward.amount,
    'counts', reward.counts,
    'memo', reward.memo
  ),
  jsonb_build_object(
    'reason', 'grant_cancel_was_reversed_after_an_inflated_fallback_award',
    'automatic_lifetime_fruit_correction_applied', false
  ),
  true,
  'A reversed grant fallback may retain inflated lifetime fruit and requires review.'
FROM currency_transactions reward
JOIN ships ship ON ship.id = reward.ship_id
WHERE reward.source = 'staff_reward'
  AND reward.type = 'increase'
  AND reward.fruit_type IS NULL
  AND reward.counts = false
  AND reward.created_at >= TIMESTAMP '2026-08-17 10:21:00'
  AND (
    reward.memo LIKE 'Cancelled HCB grant #%'
    OR reward.memo LIKE 'Bulk-cancelled HCB grant #%'
  )
  AND EXISTS (
    SELECT 1
    FROM cross_project_streak_reward_evidence evidence
    WHERE evidence.project_id = ship.project_id
      AND evidence.created_at <= reward.created_at
  )
  AND NOT EXISTS (
    SELECT 1
    FROM project_grants current_grant
    WHERE current_grant.cancel_fruit_tx_id = reward.id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM audit_logs prior
    WHERE prior.action = 'cross_project_reversed_grant_fallback_requires_manual_review'
      AND prior.entity_type = 'currency_transaction'
      AND prior.entity_id = reward.id::text
  );

CREATE TEMP TABLE cross_project_achievement_repairs ON COMMIT DROP AS
WITH thresholds(achievement_key, threshold) AS (
  VALUES
    ('on-fire'::text, 5),
    ('ablaze'::text, 10),
    ('raging'::text, 15),
    ('inferno'::text, 30),
    ('unstoppable'::text, 50),
    ('legendary'::text, 75),
    ('professional'::text, 6)
), affected_users AS (
  SELECT DISTINCT
    evidence.user_id,
    (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(owner.timezone, 'UTC'))::date AS today
  FROM cross_project_streak_reward_evidence evidence
  JOIN users owner ON owner.id = evidence.user_id
), user_calendar AS (
  SELECT
    affected.user_id,
    affected.today,
    calendar.day::date AS day,
    streak.status
  FROM affected_users affected
  CROSS JOIN LATERAL generate_series(
    DATE '2026-04-21',
    affected.today,
    INTERVAL '1 day'
  ) calendar(day)
  LEFT JOIN streak_days streak
    ON streak.user_id = affected.user_id
   AND streak.day = calendar.day::date::text
), run_anchors AS (
  SELECT
    affected.user_id,
    CASE
      WHEN today.status IN ('active', 'frozen', 'review_protected')
        THEN affected.today
      ELSE affected.today - 1
    END AS anchor_day
  FROM affected_users affected
  LEFT JOIN user_calendar today
    ON today.user_id = affected.user_id
   AND today.day = affected.today
), run_breaks AS (
  SELECT
    anchor.user_id,
    anchor.anchor_day,
    max(calendar.day) FILTER (
      WHERE calendar.status IS NULL
        OR calendar.status NOT IN ('active', 'frozen', 'review_protected')
    ) AS last_break
  FROM run_anchors anchor
  JOIN user_calendar calendar
    ON calendar.user_id = anchor.user_id
   AND calendar.day <= anchor.anchor_day
  GROUP BY anchor.user_id, anchor.anchor_day
), user_runs AS (
  SELECT
    breaks.user_id,
    count(*) FILTER (
      WHERE calendar.day > COALESCE(breaks.last_break, DATE '2026-04-20')
        AND calendar.status IN ('active', 'frozen')
    )::integer AS current_streak
  FROM run_breaks breaks
  JOIN user_calendar calendar
    ON calendar.user_id = breaks.user_id
   AND calendar.day <= breaks.anchor_day
  GROUP BY breaks.user_id
), protected_projects AS (
  SELECT DISTINCT ship.user_id, ship.project_id
  FROM ships ship
  JOIN affected_users affected ON affected.user_id = ship.user_id
  WHERE ship.status IN (
    'under_review', 'pending_fraud_review', 'pending_second_pass', 'needs_changes'
  )
), team_projects AS (
  SELECT DISTINCT project.user_id, project.id AS project_id
  FROM projects project
  JOIN affected_users affected ON affected.user_id = project.user_id
  JOIN project_collaborators collaborator
    ON collaborator.project_id = project.id
   AND collaborator.status = 'active'
  WHERE cardinality(project.hackatime_projects) > 0
), work_availability AS (
  SELECT
    affected.user_id,
    bool_or(
      project.id IS NOT NULL
      AND team.project_id IS NULL
      AND protected.project_id IS NULL
    ) AS has_workable_solo
  FROM affected_users affected
  LEFT JOIN projects project ON project.user_id = affected.user_id
  LEFT JOIN team_projects team
    ON team.user_id = affected.user_id
   AND team.project_id = project.id
  LEFT JOIN protected_projects protected
    ON protected.user_id = affected.user_id
   AND protected.project_id = project.id
  GROUP BY affected.user_id
), review_floors AS (
  SELECT
    ship.user_id,
    max(ship.user_streak_at_submission) AS review_floor
  FROM ships ship
  JOIN work_availability availability ON availability.user_id = ship.user_id
  WHERE ship.status IN (
      'under_review', 'pending_fraud_review', 'pending_second_pass', 'needs_changes'
    )
    AND ship.reviewed_at IS NULL
    AND NOT COALESCE(availability.has_workable_solo, false)
  GROUP BY ship.user_id
), current_stats AS (
  SELECT
    affected.user_id,
    greatest(
      COALESCE(run.current_streak, 0),
      COALESCE(max(project.project_streak_days), 0),
      COALESCE(review.review_floor, 0)
    ) AS headline_streak,
    COALESCE(max(project.stage), 0) AS max_stage
  FROM affected_users affected
  LEFT JOIN user_runs run ON run.user_id = affected.user_id
  LEFT JOIN projects project ON project.user_id = affected.user_id
  LEFT JOIN review_floors review ON review.user_id = affected.user_id
  GROUP BY affected.user_id, run.current_streak, review.review_floor
), direct_repairs AS (
  SELECT DISTINCT ON (achievement.user_id, achievement.achievement_key)
    achievement.user_id,
    achievement.achievement_key,
    achievement.unlocked_at,
    evidence.project_id,
    evidence.audit_id AS evidence_audit_id,
    evidence.bad_streak,
    evidence.expected_streak
  FROM user_achievements achievement
  JOIN thresholds threshold USING (achievement_key)
  JOIN cross_project_streak_reward_evidence evidence
    ON evidence.user_id = achievement.user_id
   AND evidence.created_at <= achievement.unlocked_at
   AND evidence.bad_streak >= threshold.threshold
   AND evidence.expected_streak < threshold.threshold
  JOIN current_stats current ON current.user_id = achievement.user_id
  WHERE achievement.unlocked_at >= TIMESTAMP '2026-08-17 10:21:00'
    AND CASE
      WHEN achievement.achievement_key = 'professional'
        THEN current.max_stage < 3
      ELSE current.headline_streak < threshold.threshold
    END
  ORDER BY
    achievement.user_id,
    achievement.achievement_key,
    evidence.created_at DESC,
    evidence.audit_id DESC
), dependent_repairs AS (
  SELECT
    achievement.user_id,
    achievement.achievement_key,
    achievement.unlocked_at,
    direct.project_id,
    direct.evidence_audit_id,
    direct.bad_streak,
    direct.expected_streak
  FROM user_achievements achievement
  JOIN LATERAL (
    SELECT repair.*
    FROM direct_repairs repair
    WHERE repair.user_id = achievement.user_id
      AND repair.unlocked_at <= achievement.unlocked_at
    ORDER BY repair.unlocked_at DESC
    LIMIT 1
  ) direct ON true
  WHERE achievement.achievement_key = 'perfectionist'
    AND (
      SELECT count(*)
      FROM user_achievements remaining
      WHERE remaining.user_id = achievement.user_id
        AND remaining.achievement_key <> 'perfectionist'
        AND remaining.achievement_key IN (
          'on-fire', 'ablaze', 'raging', 'inferno', 'unstoppable', 'legendary',
          'first-gold', 'gilded', 'hoarder', 'mr-krabs', 'bank-of-macondo',
          'planted', 'growing', 'forest', 'prepared', 'professional'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM direct_repairs removed
          WHERE removed.user_id = remaining.user_id
            AND removed.achievement_key = remaining.achievement_key
        )
    ) < 15
)
SELECT * FROM direct_repairs
UNION ALL
SELECT * FROM dependent_repairs;

INSERT INTO audit_logs (
  actor_id, action, entity_type, entity_id, old_value, new_value, sensitive, change_summary
)
SELECT
  'system-streak-repair',
  'cross_project_achievement_repaired',
  'achievement',
  repair.user_id || ':' || repair.achievement_key,
  jsonb_build_object(
    'achievement_key', repair.achievement_key,
    'unlocked_at', repair.unlocked_at,
    'project_id', repair.project_id,
    'evidence_audit_id', repair.evidence_audit_id,
    'bad_streak', repair.bad_streak
  ),
  jsonb_build_object(
    'achievement_key', repair.achievement_key,
    'corrected_streak', repair.expected_streak,
    'automatic_revocation_applied', true
  ),
  true,
  'Revoked an achievement whose threshold was crossed only by verified cross-project streak inflation.'
FROM cross_project_achievement_repairs repair;

DELETE FROM user_achievements achievement
USING cross_project_achievement_repairs repair
WHERE achievement.user_id = repair.user_id
  AND achievement.achievement_key = repair.achievement_key
  AND achievement.unlocked_at = repair.unlocked_at;

CREATE TEMP TABLE cross_project_reset_snapshot_repairs ON COMMIT DROP AS
SELECT
  reset.id AS reset_audit_id,
  reset.entity_id AS user_id,
  reset.created_at AS reset_created_at,
  reset.old_value,
  jsonb_set(reset.old_value, '{projects}', corrected.projects) AS corrected_old_value
FROM audit_logs reset
CROSS JOIN LATERAL (
  SELECT jsonb_agg(
    COALESCE((
      SELECT jsonb_set(
        project_snapshot.value,
        '{project_streak_days}',
        to_jsonb(greatest(
          0,
          (project_snapshot.value->>'project_streak_days')::integer
            - (repair.new_value->>'removed_days')::integer
        ))
      )
      FROM audit_logs repair
      WHERE project_snapshot.value->>'id' ~ '^[0-9]+$'
        AND project_snapshot.value->>'project_streak_days' ~ '^[0-9]+$'
        AND repair.action = 'cross_project_streak_inflation_repaired'
        AND repair.entity_type = 'project'
        AND repair.entity_id = project_snapshot.value->>'id'
        AND repair.new_value->>'removed_days' ~ '^[0-9]+$'
        AND repair.old_value->>'evidence_bad_streak' ~ '^[0-9]+$'
        AND CASE
          WHEN repair.old_value->>'evidence_audit_created_at'
            ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'
            THEN (repair.old_value->>'evidence_audit_created_at')::timestamp <= reset.created_at
          ELSE false
        END
        AND (project_snapshot.value->>'project_streak_days')::integer
          >= (repair.old_value->>'evidence_bad_streak')::integer
      ORDER BY repair.created_at DESC, repair.id DESC
      LIMIT 1
    ), project_snapshot.value)
    ORDER BY project_snapshot.ordinality
  ) AS projects
  FROM jsonb_array_elements(reset.old_value->'projects')
    WITH ORDINALITY AS project_snapshot(value, ordinality)
) corrected
WHERE reset.action = 'all_streaks_reset'
  AND reset.entity_type = 'user'
  AND reset.created_at >= TIMESTAMP '2026-08-17 10:21:00'
  AND jsonb_typeof(reset.old_value->'projects') = 'array'
  AND NOT EXISTS (
    SELECT 1
    FROM audit_logs prior
    WHERE prior.action = 'cross_project_reset_snapshot_repaired'
      AND prior.entity_type = 'user'
      AND prior.old_value->>'reset_audit_id' = reset.id::text
  )
  AND corrected.projects IS DISTINCT FROM reset.old_value->'projects';

INSERT INTO audit_logs (
  actor_id, action, entity_type, entity_id, old_value, new_value, sensitive, change_summary
)
SELECT
  'system-streak-repair',
  'cross_project_reset_snapshot_repaired',
  'user',
  repair.user_id,
  jsonb_build_object(
    'reset_audit_id', repair.reset_audit_id,
    'reset_created_at', repair.reset_created_at,
    'projects', repair.old_value->'projects'
  ),
  jsonb_build_object(
    'reset_audit_id', repair.reset_audit_id,
    'projects', repair.corrected_old_value->'projects'
  ),
  true,
  'Removed verified cross-project inflation from a restorable streak-reset snapshot.'
FROM cross_project_reset_snapshot_repairs repair;

UPDATE audit_logs reset
SET old_value = repair.corrected_old_value
FROM cross_project_reset_snapshot_repairs repair
WHERE reset.id = repair.reset_audit_id
  AND reset.old_value = repair.old_value;

INSERT INTO audit_logs (
  actor_id, action, entity_type, entity_id, old_value, new_value, sensitive, change_summary
)
SELECT
  'system-streak-repair',
  'cross_project_streak_reward_repair_requires_manual_review',
  'ship',
  candidate.id::text,
  jsonb_build_object(
    'status', candidate.status,
    'approval_at', candidate.approval_at,
    'project_id', candidate.project_id,
    'inflation_days', candidate.inflation,
    'old_multiplier', candidate.old_multiplier,
    'reconstructed_bad_multiplier', candidate.reconstructed_bad_multiplier,
    'old_gold_reward', candidate.old_gold_reward
  ),
  jsonb_build_object(
    'reason', CASE
      WHEN valid.id IS NULL THEN 'approval_snapshot_did_not_reconcile'
      WHEN candidate.status = 'pending_second_pass'
        THEN 'pending_reward_changed_before_repair'
      ELSE 'paid_ledger_balance_contributor_or_lifetime_counter_did_not_reconcile'
    END,
    'automatic_clawback_applied', false
  ),
  true,
  'Affected approval was identified but failed exact automatic-repair guards; manual finance review is required.'
FROM cross_project_reward_candidates candidate
LEFT JOIN cross_project_valid_reward_repairs valid ON valid.id = candidate.id
LEFT JOIN cross_project_pending_reward_repairs pending ON pending.id = candidate.id
LEFT JOIN cross_project_paid_reward_repairs paid ON paid.id = candidate.id
LEFT JOIN cross_project_fraud_reward_repairs fraud ON fraud.id = candidate.id
WHERE (
    valid.id IS NULL
    OR (candidate.status = 'pending_second_pass' AND pending.id IS NULL)
    OR (
      candidate.status <> 'pending_second_pass'
      AND paid.id IS NULL
      AND fraud.id IS NULL
    )
  )
  AND NOT EXISTS (
    SELECT 1
    FROM audit_logs prior
    WHERE prior.action IN (
      'cross_project_streak_reward_repaired',
      'cross_project_streak_reward_repair_requires_manual_review'
    )
      AND prior.entity_type = 'ship'
      AND prior.entity_id = candidate.id::text
  );
