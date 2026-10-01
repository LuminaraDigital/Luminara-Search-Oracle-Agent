-- Weekly Decision Loop durable tables (WDL plan: prefer 0014 for WDL, not budgets).
-- Extends Instant Audit findings with cross-device Decision Cards + honesty captures.

CREATE TABLE IF NOT EXISTS weekly_decisions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT,
  domain TEXT NOT NULL,
  week_key TEXT NOT NULL,
  title TEXT NOT NULL,
  why_text TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  prepare_status TEXT NOT NULL DEFAULT 'none',
  verify_by INTEGER,
  finding_id TEXT,
  commitment_json TEXT,
  confidence TEXT NOT NULL DEFAULT 'medium',
  data_freshness TEXT NOT NULL DEFAULT 'sample',
  status TEXT NOT NULL DEFAULT 'open',
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (account_id, domain, week_key)
);

CREATE INDEX IF NOT EXISTS idx_weekly_decisions_account
  ON weekly_decisions(account_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_weekly_decisions_domain
  ON weekly_decisions(account_id, domain, week_key);

CREATE TABLE IF NOT EXISTS ai_answer_captures (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT,
  domain TEXT NOT NULL,
  engine TEXT NOT NULL,
  prompt TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '',
  presence TEXT NOT NULL DEFAULT 'unknown',
  recommended INTEGER NOT NULL DEFAULT 0,
  cited INTEGER NOT NULL DEFAULT 0,
  measurement_status TEXT NOT NULL DEFAULT 'not_measured',
  accuracy_vs_dna TEXT NOT NULL DEFAULT 'unknown',
  sources_json TEXT NOT NULL DEFAULT '[]',
  label TEXT NOT NULL DEFAULT 'Sample',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_answers_account_domain
  ON ai_answer_captures(account_id, domain, created_at DESC);

CREATE TABLE IF NOT EXISTS prepared_assets (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  finding_id TEXT,
  weekly_decision_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (status IN ('draft', 'ready', 'exported')),
  CHECK (status != 'published')
);

CREATE INDEX IF NOT EXISTS idx_prepared_assets_account
  ON prepared_assets(account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS reputation_alerts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  acknowledged INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  ack_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_reputation_alerts_account
  ON reputation_alerts(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS thin_stack_inventory (
  account_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  items_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, domain)
);
