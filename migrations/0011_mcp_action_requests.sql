-- MCP Tool Governance: action requests for destructive tool calls.
-- One row per approval request; approvals expire 30 minutes after creation.

CREATE TABLE IF NOT EXISTS mcp_action_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  project_id TEXT,
  tool_name TEXT NOT NULL,
  args_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by TEXT,
  decided_at INTEGER,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_action_requests_user
  ON mcp_action_requests(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mcp_action_requests_pending
  ON mcp_action_requests(user_id, tool_name, project_id, status);
