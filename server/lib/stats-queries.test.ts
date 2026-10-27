import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { hoursFunnelQuery, shipStatsQuery, userStatsQuery } from "./stats-queries";

// Execute the actual aggregate SQL offline. SQLite supports FILTER and IS
// DISTINCT FROM; remove PostgreSQL's result casts and map LEAST to scalar MIN.
// This checks predicates/aggregation, not PostgreSQL plans or numeric conversion.
function queryText(query: SQL) {
  const rendered = new PgDialect().sqlToQuery(query);
  expect(rendered.params).toEqual([]);
  return rendered.sql.replace(/::(?:int|float8)\b/g, "").replace(/LEAST\(/g, "MIN(");
}

function withDb(run: (db: Database) => void) {
  const db = new Database(":memory:");
  try {
    db.exec(`
      CREATE TABLE users (
        is_temp BOOLEAN, onboarding_step TEXT, referred_by_user_id TEXT,
        sub TEXT, slack_id TEXT, hca_verification_status TEXT
      );
      CREATE TABLE ships (
        user_id TEXT, project_id INTEGER, status TEXT,
        hackatime_hours REAL, override_hours REAL
      );
    `);
    run(db);
  } finally {
    db.close();
  }
}

function legacyUsers(db: Database) {
  const count = (where = "true") =>
    (db.query(`SELECT count(*) AS c FROM users WHERE ${where}`).get() as { c: number }).c;
  return {
    total_users: count(),
    linked_hca: count("is_temp = false"),
    completed_onboarding: count("onboarding_step = 'complete'"),
    referred_total: count("referred_by_user_id IS NOT NULL"),
    referred_qualified: count(`referred_by_user_id IS NOT NULL AND sub IS NOT NULL
      AND is_temp = false AND onboarding_step IS DISTINCT FROM 'welcome'`),
    users_with_slack_linked: count("slack_id IS NOT NULL"),
  };
}

function legacyShips(db: Database) {
  const pending = db.query(`SELECT COALESCE(SUM(hackatime_hours), 0) AS h
    FROM ships WHERE status IN ('under_review', 'pending_fraud_review')`).get() as { h: number };
  const approved = db.query(`SELECT COALESCE(SUM(override_hours), 0) AS h
    FROM ships WHERE status IN ('shipped', 'shipped_missing_airtable')`).get() as { h: number };
  const userHours = db.query(`SELECT COALESCE(SUM(hackatime_hours), 0) AS h
    FROM ships GROUP BY user_id`).all() as { h: number }[];
  return {
    pending_hours: pending.h,
    approved_hours: approved.h,
    logged_1h: userHours.filter(({ h }) => h >= 1).length,
    logged_5h: userHours.filter(({ h }) => h >= 5).length,
    logged_10h: userHours.filter(({ h }) => h >= 10).length,
  };
}

describe("stats aggregate consolidation", () => {
  test("empty tables still return one zero-valued aggregate row", () => withDb((db) => {
    expect(db.query(queryText(userStatsQuery)).all()).toEqual([legacyUsers(db)]);
    expect(db.query(queryText(shipStatsQuery)).all()).toEqual([legacyShips(db)]);
  }));

  test("user predicates retain NULL, empty IDs, duplicate Slack IDs and historical referral rules", () => withDb((db) => {
    db.exec(`INSERT INTO users VALUES
      (false, 'complete', 'ref', 'sub', 'U1', 'verified'),
      (false, NULL, 'ref', 'sub', 'U1', 'pending'),
      (false, 'welcome', 'ref', 'sub', '', 'verified'),
      (true, 'complete', 'ref', 'sub', NULL, 'verified'),
      (NULL, 'complete', 'ref', 'sub', NULL, 'verified'),
      (false, 'complete', 'ref', NULL, NULL, 'verified'),
      (false, 'complete', NULL, 'sub', 'U2', 'verified'),
      (false, 'profile', '', '', NULL, NULL);
    `);
    const result = db.query(queryText(userStatsQuery)).get();
    expect(result).toEqual(legacyUsers(db));
    expect(result).toEqual({
      total_users: 8, linked_hca: 6, completed_onboarding: 5,
      referred_total: 7, referred_qualified: 3, users_with_slack_linked: 4,
    });
  }));

  test("headline statuses differ from logged thresholds; repeated projects are SUMmed", () => withDb((db) => {
    db.exec(`INSERT INTO ships VALUES
      ('repeat', 1, 'shipped', 3, 2),
      ('repeat', 1, 'under_review', 7, 999),
      ('pending', 2, 'pending_fraud_review', 1.25, 999),
      ('approved', 3, 'shipped_missing_airtable', 4.75, 4.5),
      ('second', 4, 'pending_second_pass', 5, 999),
      ('cancelled', 5, 'cancelled', 10, 999),
      ('nulls', 6, 'under_review', NULL, NULL),
      ('nulls', 6, 'shipped', NULL, NULL),
      ('negative', 7, 'under_review', -0.25, NULL),
      ('negative', 7, 'shipped', NULL, -0.5);
    `);
    const result = db.query(queryText(shipStatsQuery)).get();
    expect(result).toEqual(legacyShips(db));
    expect(result).toEqual({
      pending_hours: 8, approved_hours: 6,
      logged_1h: 5, logged_5h: 3, logged_10h: 2,
    });
  }));

  test("inclusive fractional thresholds count users rather than submissions", () => withDb((db) => {
    db.exec(`INSERT INTO ships VALUES
      ('below1', 1, 'cancelled', 0.99, 0),
      ('at1', 2, 'cancelled', 0.5, 0),
      ('at1', 2, 'cancelled', 0.5, 0),
      ('below5', 3, 'cancelled', 4.99, 0),
      ('at5', 4, 'cancelled', 5, 0),
      ('below10', 5, 'cancelled', 9.99, 0),
      ('at10', 6, 'cancelled', 10, 0);
    `);
    expect(db.query(queryText(shipStatsQuery)).get()).toEqual({
      pending_hours: 0, approved_hours: 0,
      logged_1h: 5, logged_5h: 3, logged_10h: 1,
    });
    expect(db.query(queryText(shipStatsQuery)).get()).toEqual(legacyShips(db));
  }));

  test("all-NULL hour groups do not turn missing sums into users with hours", () => withDb((db) => {
    db.exec(`INSERT INTO ships VALUES
      ('a', 1, 'under_review', NULL, NULL),
      ('b', 2, 'shipped', NULL, NULL);
    `);
    expect(db.query(queryText(shipStatsQuery)).get()).toEqual({
      pending_hours: 0, approved_hours: 0,
      logged_1h: 0, logged_5h: 0, logged_10h: 0,
    });
  }));
});

const legacyHoursFunnel = `
  WITH logged AS (
    SELECT user_id, SUM(journal_seconds + hackatime_seconds) / 3600.0 AS hours
    FROM daily_project_activity GROUP BY user_id
    HAVING SUM(journal_seconds + hackatime_seconds) > 0
  ),
  ship_hours AS (
    SELECT s.user_id, s.status,
      COALESCE(s.hackatime_hours, 0)
        + COALESCE((SELECT SUM(j.hours) FROM journals j WHERE j.linked_ship = s.id), 0)
        AS submitted_hours,
      COALESCE(s.override_hours, 0) AS approved_hours
    FROM ships s
  ),
  pending AS (
    SELECT user_id, SUM(submitted_hours) AS hours FROM ship_hours
    WHERE status IN ('under_review', 'pending_fraud_review', 'pending_second_pass')
    GROUP BY user_id HAVING SUM(submitted_hours) > 0
  ),
  approved AS (
    SELECT user_id, SUM(approved_hours) AS hours FROM ship_hours
    WHERE status IN ('shipped', 'shipped_missing_airtable')
    GROUP BY user_id HAVING SUM(approved_hours) > 0
  ),
  all_metrics AS (
    SELECT 'logged' AS metric, hours FROM logged
    UNION ALL SELECT 'pending', hours FROM pending
    UNION ALL SELECT 'approved', hours FROM approved
  )
  SELECT metric, MIN(FLOOR(hours / 10), 10) AS bucket,
    COUNT(*) AS users, ROUND(SUM(hours)) AS total_hours
  FROM all_metrics GROUP BY 1, 2
`;

function withFunnelDb(run: (db: Database) => void) {
  withDb((db) => {
    db.exec(`
      ALTER TABLE ships ADD COLUMN id INTEGER;
      CREATE TABLE journals (linked_ship INTEGER, hours REAL);
      CREATE TABLE daily_project_activity (
        user_id TEXT, journal_seconds INTEGER, hackatime_seconds INTEGER
      );
    `);
    run(db);
  });
}

function expectFunnelEquivalent(db: Database) {
  // Row order is unspecified by both queries; compare sorted bucket rows.
  const ordered = (query: string) => db.query(`
    SELECT * FROM (${query}) ORDER BY metric, bucket
  `).all();
  const result = ordered(queryText(hoursFunnelQuery));
  expect(result).toEqual(ordered(legacyHoursFunnel));
  return result;
}

describe("hours funnel journal preaggregation", () => {
  test("empty inputs and unlinked/orphan journals yield no buckets", () => withFunnelDb((db) => {
    expect(expectFunnelEquivalent(db)).toEqual([]);
    db.exec(`INSERT INTO journals VALUES (NULL, 100), (999, 100);`);
    expect(expectFunnelEquivalent(db)).toEqual([]);
  }));

  test("multiple journals join once, all pending/approved statuses retain their semantics", () => withFunnelDb((db) => {
    db.exec(`
      INSERT INTO ships (id, user_id, project_id, status, hackatime_hours, override_hours) VALUES
        (1, 'pending', 1, 'under_review', 5, 900),
        (2, 'pending', 1, 'pending_fraud_review', 2, 900),
        (3, 'second', 2, 'pending_second_pass', NULL, 900),
        (4, 'approved', 3, 'shipped', 500, 7),
        (5, 'approved', 3, 'shipped_missing_airtable', 500, 13),
        (6, 'cancelled', 4, 'cancelled', 500, 500),
        (7, 'nulls', 5, 'under_review', NULL, NULL),
        (8, 'nulls', 5, 'shipped', NULL, NULL),
        (9, 'no-journals', 6, 'under_review', 10, NULL),
        (10, 'rejected', 7, 'rejected', 500, 500),
        (11, 'needs-changes', 8, 'needs_changes', 500, 500);
      INSERT INTO journals VALUES
        (1, 3), (1, 4), (1, NULL), (2, -1), (3, 100.5),
        (4, 900), (5, 900), (6, 900), (7, NULL), (10, 900), (11, 900),
        (NULL, 9999), (999, 9999);
      INSERT INTO daily_project_activity VALUES
        ('logged', 1800, 1800), ('logged', 32400, 0),
        ('cap', 360000, 3600), ('nulls', NULL, 36000),
        ('nulls', 36000, NULL), ('zero', 0, 0), ('negative', -3600, 0);
    `);
    expect(expectFunnelEquivalent(db)).toEqual([
      { metric: 'approved', bucket: 2, users: 1, total_hours: 20 },
      { metric: 'logged', bucket: 1, users: 1, total_hours: 10 },
      { metric: 'logged', bucket: 10, users: 1, total_hours: 101 },
      { metric: 'pending', bucket: 1, users: 2, total_hours: 23 },
      { metric: 'pending', bucket: 10, users: 1, total_hours: 101 },
    ]);
  }));

  test("user sums precede positivity filters and bucket rounding", () => withFunnelDb((db) => {
    db.exec(`
      INSERT INTO ships (id, user_id, status, hackatime_hours, override_hours) VALUES
        (1, 'offset', 'under_review', 10, NULL),
        (2, 'offset', 'pending_second_pass', 1, NULL),
        (3, 'negative', 'pending_fraud_review', 1, NULL),
        (4, 'zero', 'under_review', 1, NULL),
        (5, 'fraction-a', 'under_review', 0.25, NULL),
        (6, 'fraction-b', 'pending_second_pass', 0.25, NULL),
        (7, 'approved-offset', 'shipped', NULL, 11),
        (8, 'approved-offset', 'shipped_missing_airtable', NULL, -1),
        (9, 'approved-zero', 'shipped', NULL, 0);
      INSERT INTO journals VALUES (2, -2), (3, -2), (4, -1);
      INSERT INTO daily_project_activity VALUES
        ('logged-offset', 72000, 0), ('logged-offset', -36000, 0),
        ('logged-zero', 3600, 0), ('logged-zero', -3600, 0);
    `);
    expect(expectFunnelEquivalent(db)).toEqual([
      { metric: 'approved', bucket: 1, users: 1, total_hours: 10 },
      { metric: 'logged', bucket: 1, users: 1, total_hours: 10 },
      { metric: 'pending', bucket: 0, users: 3, total_hours: 10 },
    ]);
  }));
});
