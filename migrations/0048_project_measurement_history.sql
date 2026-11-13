-- Per-project measurement history and the recommendation outcomes judged against it.
-- Rollback: DROP TABLE project_action_outcomes; DROP TABLE project_measurement_snapshots;

CREATE TABLE IF NOT EXISTS project_measurement_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('audit', 'keyword', 'ai_visibility', 'instant_audit')),
  measured_at INTEGER NOT NULL,
  source_ref TEXT NOT NULL,
  signals_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (account_id, project_id, kind, source_ref)
);

CREATE INDEX IF NOT EXISTS idx_project_snapshots_project
  ON project_measurement_snapshots(account_id, project_id, measured_at DESC);

CREATE TABLE IF NOT EXISTS project_action_outcomes (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  action_key TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('audit', 'keyword', 'ai_visibility', 'instant_audit')),
  status TEXT NOT NULL CHECK (status IN ('recommended', 'done', 'detected')),
  metric TEXT NOT NULL,
  before_snapshot_id TEXT,
  after_snapshot_id TEXT,
  before_value REAL,
  after_value REAL,
  lift REAL,
  data_label TEXT NOT NULL CHECK (data_label IN ('measured', 'too_little_data')),
  recommended_at INTEGER NOT NULL,
  resolved_at INTEGER,
  UNIQUE (account_id, project_id, action_key)
);

CREATE INDEX IF NOT EXISTS idx_project_outcomes_project
  ON project_action_outcomes(account_id, project_id, recommended_at DESC);
