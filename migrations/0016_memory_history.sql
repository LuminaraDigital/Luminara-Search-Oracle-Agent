-- Append-only memory change history (mem0-style invariant: history in D1 even when vectors live elsewhere).

CREATE TABLE IF NOT EXISTS memory_history (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  memory_fact_id TEXT,
  event TEXT NOT NULL,
  text_snapshot TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  CHECK (event IN ('ADD', 'UPDATE', 'DELETE', 'NONE'))
);

CREATE INDEX IF NOT EXISTS idx_memory_history_account
  ON memory_history(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_history_fact
  ON memory_history(memory_fact_id, created_at DESC);
