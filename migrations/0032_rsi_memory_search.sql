-- Indexed audits and chats for cross-session search.

CREATE TABLE IF NOT EXISTS rsi_memory_documents (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  domain TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source_id TEXT,
  created_at INTEGER NOT NULL,
  CHECK (kind IN ('audit', 'chat'))
);

CREATE INDEX IF NOT EXISTS idx_rsi_memory_documents_account
  ON rsi_memory_documents(account_id, created_at DESC);
