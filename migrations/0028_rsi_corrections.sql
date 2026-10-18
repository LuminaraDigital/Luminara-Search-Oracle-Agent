-- Corrections as eval cases, reward-weight history, and gated prompt publishes.

CREATE TABLE IF NOT EXISTS rsi_eval_cases (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  prompt TEXT NOT NULL,
  bad_excerpt TEXT NOT NULL,
  good_excerpt TEXT NOT NULL,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  yaml_text TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  CHECK (active IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_rsi_eval_cases_account
  ON rsi_eval_cases(account_id, active, created_at DESC);

CREATE TABLE IF NOT EXISTS rsi_reward_profiles (
  account_id TEXT PRIMARY KEY,
  weights_json TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  last_nudge_week TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  CHECK (pinned IN (0, 1))
);

CREATE TABLE IF NOT EXISTS rsi_reward_revisions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  weights_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rsi_reward_revisions_account
  ON rsi_reward_revisions(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rsi_prompt_changes (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  version INTEGER NOT NULL,
  previous_version INTEGER,
  prompt_body TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  counts_toward_cap INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  CHECK (counts_toward_cap IN (0, 1))
);

CREATE INDEX IF NOT EXISTS idx_rsi_prompt_changes_account
  ON rsi_prompt_changes(account_id, created_at DESC);
