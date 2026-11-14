-- 30, 60 and 90 day follow-ups for a recorded project action.
-- A measured row stores both scores, the delta, both timestamps, and the source.
-- A row with no score stays not_measured. Pending rows are not due yet.
-- Rollback: DROP TABLE project_outcome_followups;

CREATE TABLE IF NOT EXISTS project_outcome_followups (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  outcome_id TEXT NOT NULL,
  horizon_days INTEGER NOT NULL CHECK (horizon_days IN (30, 60, 90)),
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'measured', 'not_measured')),
  attempts INTEGER NOT NULL DEFAULT 0,
  baseline_snapshot_id TEXT,
  followup_snapshot_id TEXT,
  before_value REAL,
  after_value REAL,
  delta REAL,
  source_ref TEXT NOT NULL DEFAULT '',
  baseline_measured_at INTEGER,
  measured_at INTEGER,
  judged_at INTEGER,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (account_id, outcome_id, horizon_days),
  CHECK (
    (
      status = 'pending'
      AND judged_at IS NULL
      AND measured_at IS NULL
      AND after_value IS NULL
      AND delta IS NULL
      AND followup_snapshot_id IS NULL
    )
    OR (
      status = 'measured'
      AND judged_at IS NOT NULL
      AND measured_at IS NOT NULL
      AND before_value IS NOT NULL
      AND after_value IS NOT NULL
      AND delta IS NOT NULL
      AND baseline_snapshot_id IS NOT NULL
      AND baseline_measured_at IS NOT NULL
      AND followup_snapshot_id IS NOT NULL
      AND source_ref != ''
    )
    OR (
      status = 'not_measured'
      AND judged_at IS NOT NULL
      AND measured_at IS NULL
      AND after_value IS NULL
      AND delta IS NULL
      AND followup_snapshot_id IS NULL
      AND source_ref != ''
      AND note = 'Not measured'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_outcome_followups_due
  ON project_outcome_followups(status, due_at);

CREATE INDEX IF NOT EXISTS idx_outcome_followups_project
  ON project_outcome_followups(account_id, project_id, horizon_days);
