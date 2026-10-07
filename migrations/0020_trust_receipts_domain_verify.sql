-- Trust Network TN1 + TN2: signed Trust Receipts and domain control verification
-- Luminara Suite D1 Migration 0020
-- Receipts are signed statements (Ed25519, worker/receiptSigning.ts). They index
-- evidence by hash; they never copy it. Only Worker verifiers mint receipts; there
-- is no client mint route. Revocation is a column, never a delete, so a public
-- verifier can show "revoked" instead of "not found".

CREATE TABLE IF NOT EXISTS trust_receipts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  subject_kind TEXT NOT NULL CHECK (subject_kind IN ('domain','business','account','agent','project')),
  subject_id TEXT NOT NULL,
  claim TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('worker_verified','registry_verified','self_reported')),
  payload_json TEXT NOT NULL,          -- canonical JSON that was signed
  signature TEXT NOT NULL,             -- base64url Ed25519 signature over payload_json
  kid TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  expires_at TEXT,
  revoked_at TEXT,
  revoked_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trust_receipts_subject ON trust_receipts(subject_kind, subject_id, claim);
CREATE INDEX IF NOT EXISTS idx_trust_receipts_account ON trust_receipts(account_id, created_at);

-- One row per (account, domain). The challenge token is stored hashed; the
-- plaintext is shown to the owner once per issue and is what they publish.
CREATE TABLE IF NOT EXISTS domain_verifications (
  account_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  token_hint TEXT NOT NULL,            -- "lv_" plus the first 6 token chars, so the owner can match what they published
  method TEXT,                         -- 'dns_txt' | 'well_known' | 'meta_tag' once verified
  status TEXT NOT NULL CHECK (status IN ('pending','verified','lapsed','revoked')),
  receipt_id TEXT,
  token_expires_at TEXT NOT NULL,
  verified_at TEXT,
  last_checked_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_domain_verifications_status ON domain_verifications(status, last_checked_at);
CREATE INDEX IF NOT EXISTS idx_domain_verifications_domain ON domain_verifications(domain, status);
