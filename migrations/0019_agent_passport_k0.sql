-- Agent Passport K0: attribute paid spend to the credential that made the call
-- Luminara Suite D1 Migration 0019
-- Tier 2 of account / agent client / session. Enables per-key spend views and,
-- in K1, per-key caps. NULL on rows written before this migration (unattributed).

ALTER TABLE cost_events ADD COLUMN credential_kind TEXT;  -- 'api_key' | 'oauth' | 'session' | 'oracle'
ALTER TABLE cost_events ADD COLUMN credential_id TEXT;    -- api_keys.id when credential_kind = 'api_key'

CREATE INDEX IF NOT EXISTS idx_cost_events_credential
  ON cost_events(account_id, credential_kind, credential_id, created_at);
