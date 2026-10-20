-- Citation Watch runs and Signed Audit Receipts.
-- Luminara Suite D1 Migration 0034
-- Existing D1 database. No new datastore. No chain columns.

CREATE TABLE IF NOT EXISTS citation_watches (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL,
  engine TEXT NOT NULL CHECK (engine IN ('chatgpt', 'google_aio', 'perplexity')),
  prompts_json TEXT NOT NULL,
  prompts_sha256 TEXT NOT NULL,
  cadence TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  next_run_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Inactive rows stay for history. Only a live watch holds the prompt-set key, so a
-- soft-deleted watch can be created again.
CREATE UNIQUE INDEX IF NOT EXISTS idx_citation_watches_prompt_set
  ON citation_watches(account_id, client_id, domain, engine, prompts_sha256)
  WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_citation_watches_due
  ON citation_watches(active, next_run_at);

CREATE TABLE IF NOT EXISTS citation_watch_runs (
  id TEXT PRIMARY KEY,
  watch_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  ran_at INTEGER NOT NULL,
  measurement_status TEXT NOT NULL CHECK (measurement_status IN ('measured', 'not_measured')),
  method TEXT NOT NULL,
  model_id TEXT,
  cited_count INTEGER,
  prompt_count INTEGER,
  share REAL,
  verdict TEXT NOT NULL CHECK (verdict IN ('consistent', 'drift', 'insufficient', 'not_measured')),
  compared_to_run_id TEXT,
  delta_share REAL,
  observations_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  CHECK (
    (measurement_status = 'not_measured' AND cited_count IS NULL AND prompt_count IS NULL AND share IS NULL)
    OR (measurement_status = 'measured' AND cited_count IS NOT NULL AND prompt_count IS NOT NULL AND share IS NOT NULL
        AND cited_count >= 0 AND prompt_count > 0 AND cited_count <= prompt_count)
  ),
  CHECK (
    (verdict = 'not_measured' AND measurement_status = 'not_measured')
    OR (verdict IN ('insufficient', 'consistent', 'drift') AND measurement_status = 'measured')
  ),
  CHECK (
    (verdict IN ('consistent', 'drift') AND delta_share IS NOT NULL AND compared_to_run_id IS NOT NULL)
    OR (verdict IN ('insufficient', 'not_measured') AND delta_share IS NULL AND compared_to_run_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_citation_watch_runs_watch
  ON citation_watch_runs(watch_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS idx_citation_watch_runs_account
  ON citation_watch_runs(account_id);

-- revoked_at is a mark, not a delete. A public verifier can show revoked.
-- The signature still covers the original payload.
CREATE TABLE IF NOT EXISTS signed_audit_receipts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  signature TEXT NOT NULL,
  kid TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  revoked_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_signed_audit_receipts_account
  ON signed_audit_receipts(account_id, created_at DESC);
