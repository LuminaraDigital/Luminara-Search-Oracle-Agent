-- Hosted memory facts (W8 / go-live G3). Vectorize embedding optional later.

CREATE TABLE IF NOT EXISTS memory_facts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'hosted',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_facts_account
  ON memory_facts(account_id, created_at);
