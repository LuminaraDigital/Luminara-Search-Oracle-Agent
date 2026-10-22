-- One public win page per row. The row stores the name, the result, and the date.
-- Findings, evidence, and the report body are not columns.

CREATE TABLE IF NOT EXISTS win_shares (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  agency_name TEXT NOT NULL,
  claim_kind TEXT NOT NULL,
  passed INTEGER,
  total INTEGER,
  fixes_done INTEGER NOT NULL DEFAULT 0,
  hide_score INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_win_shares_owner_created
  ON win_shares(owner_id, created_at DESC);
