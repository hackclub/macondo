-- Secondary indexes for the hottest, fastest-growing tables. Before this,
-- projects / ships / audit_logs had no secondary indexes at all, and
-- currency_transactions / journals only had partial indexes that could not
-- serve their hot lookups. Every dashboard load, public project page,
-- balance read, and reviewer queue was doing sequential scans that get
-- slower as the tables grow. All additive, all re-runnable on prod state.
--
-- Note on locking: a plain CREATE INDEX briefly write-locks the table while
-- it builds. These complete in well under a second at the current data
-- size. If any of the large tables (ships, journals, currency_transactions,
-- audit_logs) has grown enough to make that lock noticeable in prod, run the
-- equivalent CREATE INDEX CONCURRENTLY IF NOT EXISTS manually against prod
-- BEFORE deploying; the IF NOT EXISTS clauses below then no-op. CONCURRENTLY
-- cannot run inside the migrator's transaction, so it is intentionally not
-- used here.

-- projects: user_id drives the dashboard project list and the streak engine.
CREATE INDEX IF NOT EXISTS "projects_user_id_idx" ON "projects" ("user_id");

-- ships: reviewer queue (status), public project page active-ship lookup
-- (project_id), per-user shipped-count gate (user_id, status), assigned
-- queue join (assigned_user_id), and reviewed_at-ordered shipped lists.
CREATE INDEX IF NOT EXISTS "ships_status_idx" ON "ships" ("status");
CREATE INDEX IF NOT EXISTS "ships_project_id_idx" ON "ships" ("project_id");
CREATE INDEX IF NOT EXISTS "ships_user_id_status_idx" ON "ships" ("user_id","status");
CREATE INDEX IF NOT EXISTS "ships_assigned_user_id_idx" ON "ships" ("assigned_user_id");
CREATE INDEX IF NOT EXISTS "ships_reviewed_at_idx" ON "ships" ("reviewed_at");

-- journals: per-project fetch (project page, reward math) and the
-- review-queue hour-sum subquery keyed by linked_ship.
CREATE INDEX IF NOT EXISTS "journals_project_id_idx" ON "journals" ("project_id");
CREATE INDEX IF NOT EXISTS "journals_linked_ship_idx" ON "journals" ("linked_ship");

-- currency_transactions: every balance/fruit/starfruit read filters
-- (user_id, counts); ship_id covers the revert-ship ledger reversal.
CREATE INDEX IF NOT EXISTS "currency_transactions_user_id_counts_idx" ON "currency_transactions" ("user_id","counts");
CREATE INDEX IF NOT EXISTS "currency_transactions_ship_id_idx" ON "currency_transactions" ("ship_id");

-- audit_logs: entity timelines filter (entity_type, entity_id) and order by
-- created_at; actor lookups filter actor_id.
CREATE INDEX IF NOT EXISTS "audit_logs_entity_idx" ON "audit_logs" ("entity_type","entity_id","created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_actor_id_idx" ON "audit_logs" ("actor_id");

-- daily_project_activity: project_id is not a leftmost prefix of any existing
-- index; the internal project page filters activity by project_id.
CREATE INDEX IF NOT EXISTS "daily_project_activity_project_id_idx" ON "daily_project_activity" ("project_id");
