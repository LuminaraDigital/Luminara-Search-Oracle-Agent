-- Offline replay log for audit, probe, and ranking strategies.

CREATE TABLE IF NOT EXISTS rsi_replay_nodes (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  kind TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  outcome_score REAL,
  cost REAL NOT NULL DEFAULT 1,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  CHECK (kind IN ('audit', 'probe', 'ranking')),
  CHECK (cost >= 0)
);

CREATE INDEX IF NOT EXISTS idx_rsi_replay_nodes_lookup
  ON rsi_replay_nodes(account_id, domain, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS rsi_strategy_slots (
  account_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  kind TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  last_promotion_week TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, domain, kind),
  CHECK (kind IN ('audit', 'probe', 'ranking')),
  CHECK (pinned IN (0, 1))
);
