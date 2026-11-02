-- Migration 0044: Unified Scoped Memory, Bi-Temporal Knowledge Graph (Graphiti),
-- Encrypted Memory Vault Commitments (Anamnesis/OriginTrail), Span Telemetry (Langfuse-lite),
-- and Outbound MCP Server Registry.
-- Additive only; no em dashes.

ALTER TABLE memory_facts ADD COLUMN project_id TEXT;
ALTER TABLE memory_facts ADD COLUMN domain TEXT;
ALTER TABLE memory_facts ADD COLUMN kind TEXT NOT NULL DEFAULT 'fact';
ALTER TABLE memory_facts ADD COLUMN importance REAL NOT NULL DEFAULT 0.5;
ALTER TABLE memory_facts ADD COLUMN confidence REAL NOT NULL DEFAULT 0.8;
ALTER TABLE memory_facts ADD COLUMN content_sha256 TEXT;
ALTER TABLE memory_facts ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE memory_facts ADD COLUMN superseded_by TEXT;
ALTER TABLE memory_facts ADD COLUMN expires_at INTEGER;
ALTER TABLE memory_facts ADD COLUMN updated_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_memory_facts_scoped
  ON memory_facts(account_id, status, project_id, domain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_facts_dedupe
  ON memory_facts(account_id, content_sha256) WHERE content_sha256 IS NOT NULL AND status = 'active';

-- Bi-Temporal Knowledge Graph (Graphiti / Zep pattern): tracks entity-relationship facts
-- and when they were valid (valid_from .. valid_to) so contradictions preserve history.
CREATE TABLE IF NOT EXISTS memory_edges (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT,
  domain TEXT,
  subject_entity TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_entity TEXT NOT NULL,
  valid_from INTEGER NOT NULL,
  valid_to INTEGER,
  confidence REAL NOT NULL DEFAULT 0.8,
  derivation TEXT NOT NULL DEFAULT 'user' CHECK (derivation IN ('rule', 'model', 'user', 'verified')),
  source_ref TEXT,
  superseded_by TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_edges_lookup
  ON memory_edges(account_id, domain, subject_entity, predicate, valid_to);
CREATE INDEX IF NOT EXISTS idx_memory_edges_project
  ON memory_edges(account_id, project_id, valid_to, valid_from DESC);

-- Anamnesis + OriginTrail DKG + Context0 pattern: encrypted user-owned memory snapshots
-- with pairwise SHA-256 Merkle roots and optional TON / on-chain hash commitments.
CREATE TABLE IF NOT EXISTS memory_vault_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT,
  domain TEXT,
  merkle_root TEXT NOT NULL,
  leaf_hashes_json TEXT NOT NULL DEFAULT '[]',
  leaf_count INTEGER NOT NULL DEFAULT 0,
  ciphertext_base64 TEXT,
  iv_base64 TEXT,
  salt_base64 TEXT,
  cid TEXT NOT NULL,
  storage_backend TEXT NOT NULL DEFAULT 'd1' CHECK (storage_backend IN ('d1', 'r2', 'ipfs', 'client_only')),
  anchor_id TEXT,
  chain TEXT,
  network TEXT,
  tx_hash TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_vault_account
  ON memory_vault_snapshots(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memory_vault_merkle
  ON memory_vault_snapshots(merkle_root);

-- Langfuse / Phoenix-lite child span telemetry under run_provenance.
CREATE TABLE IF NOT EXISTS agent_trace_spans (
  span_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  parent_span_id TEXT,
  account_id TEXT NOT NULL,
  session_id TEXT,
  node_name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('llm', 'tool', 'memory', 'gate', 'verifier', 'checkpoint')),
  model_or_tool TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'waiting_approval')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_trace_spans_run
  ON agent_trace_spans(run_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_agent_trace_spans_account
  ON agent_trace_spans(account_id, created_at DESC);

-- Outbound MCP Client Connector registry for pluggable external MCP servers.
CREATE TABLE IF NOT EXISTS mcp_external_servers (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT,
  name TEXT NOT NULL,
  endpoint_url TEXT NOT NULL,
  auth_header_enc TEXT,
  allowed_tools_json TEXT NOT NULL DEFAULT '[]',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_external_servers_account
  ON mcp_external_servers(account_id, enabled);
