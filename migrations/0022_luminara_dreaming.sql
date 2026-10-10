-- Migration: 0022_luminara_dreaming.sql
-- Subsystem: Luminara Dreaming (Business DNA Memory Consolidation & Reflection Layer)

-- 1. Ingestion Queue for Un-dreamed & Processed Events
CREATE TABLE IF NOT EXISTS dream_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT,
  domain TEXT NOT NULL,
  event_type TEXT NOT NULL, -- 'audit_completed' | 'recommendation_updated' | 'client_profile_changed' | 'feedback_received'
  source_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  content_hash TEXT NOT NULL,
  signal_weight REAL NOT NULL DEFAULT 1.0,
  dream_run_id TEXT,
  created_at INTEGER NOT NULL,
  CHECK (event_type IN ('audit_completed', 'recommendation_updated', 'client_profile_changed', 'feedback_received'))
);

CREATE INDEX IF NOT EXISTS idx_dream_events_pending
  ON dream_events(account_id, domain, dream_run_id) WHERE dream_run_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_dream_events_hash
  ON dream_events(account_id, domain, content_hash);

-- 2. Durable Workspace-Scoped Business Memories
CREATE TABLE IF NOT EXISTS business_memories (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT,
  domain TEXT NOT NULL,
  memory_type TEXT NOT NULL, -- 'business_dna' | 'visibility_profile' | 'action_memory' | 'preference_memory' | 'evidence_memory'
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  structured_data_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 1.0,
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'pending' | 'rejected' | 'archived'
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_verified_at INTEGER NOT NULL,
  expires_at INTEGER,
  CHECK (memory_type IN ('business_dna', 'visibility_profile', 'action_memory', 'preference_memory', 'evidence_memory')),
  CHECK (status IN ('active', 'pending', 'rejected', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_business_memories_lookup
  ON business_memories(account_id, domain, memory_type, status);
CREATE INDEX IF NOT EXISTS idx_business_memories_expiry
  ON business_memories(status, expires_at) WHERE expires_at IS NOT NULL;

-- 3. Dream Consolidation Runs Audit Trail
CREATE TABLE IF NOT EXISTS dream_runs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT,
  domain TEXT NOT NULL,
  trigger_reason TEXT NOT NULL, -- 'scheduled_nightly' | 'post_audit' | 'threshold_exceeded' | 'manual_user' | 'mcp_trigger'
  events_evaluated_count INTEGER NOT NULL DEFAULT 0,
  proposals_count INTEGER NOT NULL DEFAULT 0,
  auto_applied_count INTEGER NOT NULL DEFAULT 0,
  pending_review_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  model_id TEXT NOT NULL DEFAULT 'gemini-2.5-flash',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  rolled_back_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_dream_runs_account
  ON dream_runs(account_id, domain, created_at DESC);

-- 4. Reviewed Mutation Proposals & Rollback Snapshots
CREATE TABLE IF NOT EXISTS dream_proposals (
  id TEXT PRIMARY KEY,
  dream_run_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  action TEXT NOT NULL, -- 'create' | 'update' | 'deprecate' | 'merge'
  memory_id TEXT,
  memory_type TEXT NOT NULL,
  title TEXT NOT NULL,
  proposed_content TEXT NOT NULL,
  structured_data_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.8,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected' | 'auto_applied' | 'rolled_back'
  rationale TEXT NOT NULL DEFAULT '',
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  previous_snapshot_json TEXT,
  reviewed_by TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  CHECK (action IN ('create', 'update', 'deprecate', 'merge')),
  CHECK (status IN ('pending', 'approved', 'rejected', 'auto_applied', 'rolled_back'))
);

CREATE INDEX IF NOT EXISTS idx_dream_proposals_pending
  ON dream_proposals(account_id, domain, status);
CREATE INDEX IF NOT EXISTS idx_dream_proposals_run
  ON dream_proposals(dream_run_id);
