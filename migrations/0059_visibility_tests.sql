-- Visibility Unit Tests. Raw answers and crawl snapshots live in R2 under raw_key.
-- These rows are what a regrade replaces, so nothing here depends on an engine being called again.
-- A null raw_key means the raw record was not saved, so that run cannot be regraded.

CREATE TABLE IF NOT EXISTS visibility_test_runs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'audit' CHECK (kind IN ('audit', 'own_models')),
  scorer_version INTEGER NOT NULL,
  raw_key TEXT,
  summary_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  graded_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_visibility_test_runs_account
  ON visibility_test_runs(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS visibility_test_answers (
  run_id TEXT NOT NULL,
  id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('search', 'byok_probe')),
  engine TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'refused', 'error')),
  cost_usd REAL,
  latency_ms INTEGER,
  answered_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, id)
);

CREATE INDEX IF NOT EXISTS idx_visibility_test_answers_account
  ON visibility_test_answers(account_id, kind, answered_at DESC);

CREATE TABLE IF NOT EXISTS visibility_test_verdicts (
  run_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  test_id TEXT NOT NULL,
  answer_id TEXT NOT NULL DEFAULT '',
  test_type TEXT NOT NULL,
  family TEXT NOT NULL CHECK (family IN ('presence', 'accuracy', 'citation', 'structure')),
  derivation TEXT NOT NULL CHECK (derivation IN ('dna_confirmed', 'site_estimated')),
  tags_json TEXT NOT NULL DEFAULT '[]',
  label TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('pass', 'fail', 'not_measured')),
  why TEXT NOT NULL,
  PRIMARY KEY (run_id, test_id, answer_id)
);

CREATE INDEX IF NOT EXISTS idx_visibility_test_verdicts_account
  ON visibility_test_verdicts(account_id, run_id);
