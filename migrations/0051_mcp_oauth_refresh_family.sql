-- MCP OAuth refresh families. One conditional update moves current_refresh_hash,
-- so two refreshes of the same token cannot both leave a live access token behind.
-- successor_enc is AES-GCM ciphertext of the new pair, kept only for the reuse grace window.
-- Access and retired refresh hashes are stored, never the raw tokens.

CREATE TABLE mcp_oauth_refresh_family (
  family_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_name TEXT,
  granted_scope TEXT NOT NULL,
  current_refresh_hash TEXT NOT NULL UNIQUE,
  revoked INTEGER NOT NULL DEFAULT 0,
  retired_refresh_hash TEXT,
  grace_until INTEGER,
  successor_enc TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE mcp_oauth_refresh_access (
  access_hash TEXT PRIMARY KEY,
  family_id TEXT NOT NULL
);

CREATE INDEX idx_mcp_oauth_refresh_access_family ON mcp_oauth_refresh_access (family_id);

CREATE TABLE mcp_oauth_refresh_retired (
  refresh_hash TEXT PRIMARY KEY,
  family_id TEXT NOT NULL
);
