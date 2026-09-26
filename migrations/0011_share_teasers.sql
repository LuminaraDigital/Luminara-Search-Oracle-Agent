-- Redacted Instant Scout teasers (free). Distinct from Growth+ shared_reports.
-- Tokens are random; only SHA-256 hashes are stored.

CREATE TABLE IF NOT EXISTS share_teasers (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  owner_account_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_share_teasers_owner ON share_teasers(owner_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_share_teasers_token ON share_teasers(token_hash);
