-- Scheduled per-project checks and the alerts those checks raise.
-- Rollback: DROP TABLE project_monitor_alerts; DROP TABLE project_monitors;

CREATE TABLE IF NOT EXISTS project_monitors (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  cadence TEXT NOT NULL CHECK (cadence IN ('monthly', 'weekly', 'daily')),
  email_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (email_opt_in IN (0, 1)),
  query_list_json TEXT NOT NULL DEFAULT '[]',
  last_run_at INTEGER,
  next_run_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (account_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_project_monitors_due
  ON project_monitors(enabled, next_run_at);

CREATE TABLE IF NOT EXISTS project_monitor_alerts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  monitor_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('regression', 'lift', 'weekly')),
  summary TEXT NOT NULL,
  snapshot_id TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER,
  UNIQUE (account_id, snapshot_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_project_monitor_alerts_project
  ON project_monitor_alerts(account_id, project_id, created_at DESC);
