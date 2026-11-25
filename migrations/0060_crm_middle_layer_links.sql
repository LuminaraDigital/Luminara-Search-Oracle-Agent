-- 0060_crm_middle_layer_links.sql
-- Strictly additive dark-launch tables linking Luminara Suite accounts and enquiries
-- to the Luminara CRM Agentic Middle Layer (crm.luminarasuite.com).

CREATE TABLE IF NOT EXISTS suite_crm_links (
  account_id TEXT PRIMARY KEY,
  crm_base_url TEXT NOT NULL,
  workspace_slug TEXT NOT NULL,
  crm_mode TEXT NOT NULL DEFAULT 'standalone',
  primary_external_crm TEXT,
  passport_token_enc TEXT NOT NULL,
  auto_promote_enquiries INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  last_synced_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS enquiry_crm_promotions (
  enquiry_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  crm_lead_id TEXT NOT NULL,
  crm_person_id TEXT,
  crm_receipt_code TEXT,
  external_crm_provider TEXT,
  external_crm_id TEXT,
  external_crm_url TEXT,
  status TEXT NOT NULL DEFAULT 'staged',
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_enquiry_crm_promotions_account
  ON enquiry_crm_promotions (account_id, updated_at DESC);
