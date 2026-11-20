-- An approval must authorise exactly the call the owner reviewed. args_json holds the
-- redacted arguments for display, so two calls that differ only in a redacted value
-- (a token, a password) stored the same text and one approval fitted both.
-- args_hash is a SHA-256 of the unredacted arguments in a stable key order; the worker
-- matches on it when it reuses a pending request and when it spends an approval.
--
-- Nullable on purpose. Rows written before this migration keep NULL and can no longer be
-- spent; a tool approval lasts 30 minutes, so the caller simply asks again.
-- kind = 'budget_override' rows never set or read this column.

ALTER TABLE mcp_action_requests ADD COLUMN args_hash TEXT;
