-- Self-serve privacy jobs, server product analytics, invoice reconcile, memory vectors.
-- Patterns inspired by industry GDPR job flows and mem0 vector adapters; Luminara-only schema.

CREATE TABLE IF NOT EXISTS privacy_jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  confirm_token_hash TEXT,
  download_token_hash TEXT,
  r2_object_key TEXT,
  error_text TEXT,
  cancel_until INTEGER,
  expires_at INTEGER,
  result_summary_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  CHECK (kind IN ('export', 'delete')),
  CHECK (status IN ('queued', 'running', 'ready', 'failed', 'cancelled', 'soft_deleted', 'purged'))
);

CREATE INDEX IF NOT EXISTS idx_privacy_jobs_account
  ON privacy_jobs(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_privacy_jobs_status
  ON privacy_jobs(status, updated_at);

CREATE TABLE IF NOT EXISTS product_analytics_events (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  session_id TEXT,
  event_type TEXT NOT NULL,
  path TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_product_analytics_account
  ON product_analytics_events(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_analytics_type
  ON product_analytics_events(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS invoice_reconcile_runs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  period_end INTEGER NOT NULL,
  internal_cents INTEGER NOT NULL,
  invoice_cents INTEGER NOT NULL,
  delta_cents INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ok',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  CHECK (status IN ('ok', 'warn', 'fail', 'reconciliation_required'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_reconcile_account
  ON invoice_reconcile_runs(account_id, created_at DESC);

-- Extend hosted memory facts for multi-provider vector ids (CF Vectorize / Azure / GCP).
ALTER TABLE memory_facts ADD COLUMN embedding_provider TEXT;
ALTER TABLE memory_facts ADD COLUMN vector_id TEXT;
ALTER TABLE memory_facts ADD COLUMN metadata_json TEXT;

CREATE TABLE IF NOT EXISTS memory_chat_extractions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  session_id TEXT,
  source_turn_id TEXT,
  fact_text TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'pending',
  memory_fact_id TEXT,
  created_at INTEGER NOT NULL,
  CHECK (status IN ('pending', 'approved', 'rejected', 'stored'))
);

CREATE INDEX IF NOT EXISTS idx_memory_extractions_account
  ON memory_chat_extractions(account_id, created_at DESC);
