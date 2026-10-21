-- Follow-up schema for Citation Watch and Signed Audit Receipts.
-- Luminara Suite D1 Migration 0035
-- 0034 shipped with a full unique index and no revoke columns. Those later
-- edits live here so an already-applied 0034 is not rewritten in place.

DROP INDEX IF EXISTS idx_citation_watches_prompt_set;
CREATE UNIQUE INDEX idx_citation_watches_prompt_set
  ON citation_watches(account_id, client_id, domain, engine, prompts_sha256)
  WHERE active = 1;

CREATE INDEX IF NOT EXISTS idx_citation_watch_runs_account
  ON citation_watch_runs(account_id);

ALTER TABLE signed_audit_receipts ADD COLUMN revoked_at INTEGER;
ALTER TABLE signed_audit_receipts ADD COLUMN revoked_reason TEXT;
