-- Approve-once budget resume reuses the spec-0010 action-request flow, which
-- needs to tell tool approvals apart from budget overrides. tool_name alone
-- cannot carry that distinction, so mcp_action_requests gains a kind column:
-- 'tool' for destructive-tool approvals, 'budget_override' for budget resumes.
-- Budget overrides do not expire on the 30 minute tool TTL; the resume scope
-- is the current UTC window, enforced in worker/budgets.ts via args_json.

ALTER TABLE mcp_action_requests ADD COLUMN kind TEXT NOT NULL DEFAULT 'tool';

CREATE INDEX IF NOT EXISTS idx_mcp_action_requests_kind
  ON mcp_action_requests(user_id, kind, status);
