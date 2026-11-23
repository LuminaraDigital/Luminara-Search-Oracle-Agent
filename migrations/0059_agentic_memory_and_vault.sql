-- Migration 0059: Encrypted Memory Vault Commitments (Anamnesis/OriginTrail),
-- Span Telemetry (Langfuse-lite), and Outbound MCP Server Registry.
-- (Scoped memory_facts columns and memory_edges were added in 0046_scoped_review_rules.sql.)
-- Additive only; no em dashes.

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
