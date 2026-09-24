-- Extend audit_runs (from 0005) for queued Agency audits (AI Functions P4)

ALTER TABLE audit_runs ADD COLUMN project_id TEXT;
ALTER TABLE audit_runs ADD COLUMN target_url TEXT;
ALTER TABLE audit_runs ADD COLUMN result_json TEXT;
ALTER TABLE audit_runs ADD COLUMN error TEXT;
ALTER TABLE audit_runs ADD COLUMN updated_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_audit_runs_status_updated ON audit_runs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_audit_runs_project ON audit_runs(project_id);
