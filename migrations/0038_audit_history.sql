-- Instant Audit history: one row per saved audit per account. The browser list is a cache of this.
-- entry_json holds the whole saved entry, report excerpt included (the client caps it at 80,000 characters).

CREATE TABLE IF NOT EXISTS audit_history (
  account_id TEXT NOT NULL,
  id TEXT NOT NULL,
  domain TEXT NOT NULL,
  measured_at INTEGER NOT NULL,
  entry_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, id)
);

CREATE INDEX IF NOT EXISTS idx_audit_history_account_measured
  ON audit_history(account_id, measured_at DESC);
