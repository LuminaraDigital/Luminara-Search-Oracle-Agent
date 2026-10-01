-- Proof ledger for chain network gating + future citation anchors (Phase 0)
-- Luminara Suite D1 Migration 0017
-- Historic ton_credited_tx backfill runs in worker/proofAnchors.ts (backfillTonPaymentAnchors)
-- so this migration stays safe when applied before 0004 in partial test fixtures.

CREATE TABLE IF NOT EXISTS proof_anchors (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  audit_run_id TEXT,
  order_id TEXT,
  domain TEXT,
  evidence_hash TEXT,
  chain TEXT NOT NULL,
  network TEXT NOT NULL,
  contract TEXT,
  tx_hash TEXT,
  seqno INTEGER,
  explorer_url TEXT,
  status TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  anchored_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_proof_anchors_domain ON proof_anchors(domain);
CREATE INDEX IF NOT EXISTS idx_proof_anchors_tx ON proof_anchors(tx_hash);
CREATE INDEX IF NOT EXISTS idx_proof_anchors_order ON proof_anchors(order_id);
CREATE INDEX IF NOT EXISTS idx_proof_anchors_kind_status ON proof_anchors(kind, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_proof_anchors_tx_kind
  ON proof_anchors(tx_hash, kind) WHERE tx_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS proof_schedules (
  domain TEXT NOT NULL,
  account_id TEXT NOT NULL,
  cadence TEXT NOT NULL DEFAULT 'weekly',
  next_run_utc TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (domain, account_id)
);

CREATE TABLE IF NOT EXISTS chain_invoices (
  order_id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  plan TEXT NOT NULL,
  amount_nano TEXT NOT NULL,
  memo TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
