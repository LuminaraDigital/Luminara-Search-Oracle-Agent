-- Visibility + agent platform foundations (plan e2e-visibility-agent-platform W0)
-- Luminara Suite D1 Migration 0005
-- Share links, audit runs/findings, hosted visibility snapshots, GSC OAuth, Agency API keys.

CREATE TABLE IF NOT EXISTS shared_reports (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  owner_account_id TEXT NOT NULL,
  client_id TEXT,
  report_json TEXT NOT NULL,
  branding_json TEXT,
  password_hash TEXT,
  expires_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shared_reports_owner ON shared_reports(owner_account_id);
CREATE INDEX IF NOT EXISTS idx_shared_reports_token ON shared_reports(token_hash);

CREATE TABLE IF NOT EXISTS audit_runs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  client_id TEXT,
  domain TEXT NOT NULL,
  focus TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  report_ref TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_runs_account ON audit_runs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_runs_domain ON audit_runs(account_id, domain);

CREATE TABLE IF NOT EXISTS audit_findings (
  id TEXT PRIMARY KEY,
  audit_run_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  client_id TEXT,
  domain TEXT NOT NULL,
  stable_key TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence_json TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  owner TEXT,
  due_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (account_id, domain, stable_key)
);

CREATE INDEX IF NOT EXISTS idx_audit_findings_account ON audit_findings(account_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_findings_run ON audit_findings(audit_run_id);

CREATE TABLE IF NOT EXISTS visibility_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  focus TEXT NOT NULL,
  measured_at INTEGER NOT NULL,
  metrics_json TEXT NOT NULL,
  engine_breakdown_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_visibility_snapshots_domain
  ON visibility_snapshots(account_id, domain, measured_at DESC);

CREATE TABLE IF NOT EXISTS gsc_oauth_tokens (
  account_id TEXT PRIMARY KEY,
  refresh_token_enc TEXT NOT NULL,
  scopes TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_api_keys_account ON api_keys(account_id);
