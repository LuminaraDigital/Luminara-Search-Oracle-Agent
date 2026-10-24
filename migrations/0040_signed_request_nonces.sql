-- Replay window for HMAC request signing. Not account data: no privacy export.
-- Signed Audit Receipts stay in signed_audit_receipts (D1). This table only
-- remembers a key id and nonce long enough to refuse a second use inside the window.

CREATE TABLE IF NOT EXISTS signed_request_nonces (
  key_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  PRIMARY KEY (key_id, nonce)
);

CREATE INDEX IF NOT EXISTS idx_signed_request_nonces_seen
  ON signed_request_nonces(seen_at);
