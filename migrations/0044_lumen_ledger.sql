-- Lumen: prepaid AI work on the Suite ledger. Not a coin and not a wallet.
-- One row per mint or spend. idempotency_key stops a replayed payment or job from moving the balance twice.
-- lumen_balances is the cache. The entry insert and the balance update run in one batch.

CREATE TABLE IF NOT EXISTS lumen_entries (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('mint', 'burn', 'void')),
  amount INTEGER NOT NULL CHECK (
    (direction = 'void' AND amount = 0) OR (direction IN ('mint', 'burn') AND amount > 0)
  ),
  source TEXT NOT NULL CHECK (source IN ('stripe', 'stars', 'ton', 'audit', 'agent', 'mcp')),
  idempotency_key TEXT NOT NULL UNIQUE,
  ref_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lumen_entries_account ON lumen_entries (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS lumen_balances (
  account_id TEXT PRIMARY KEY,
  balance INTEGER NOT NULL CHECK (balance >= 0),
  updated_at INTEGER NOT NULL
);
