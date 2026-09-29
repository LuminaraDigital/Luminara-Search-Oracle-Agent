-- Budget Policies and Enforcement (spec 0014, design record spec 0013).
-- Account-level monthly (calendar_month_utc) billed-cents budgets with soft
-- alerts at 50/80/95 and a hard stop at 100. Project-lifetime budget columns
-- are schema-included (P2) but not enforced yet; do not read them as live
-- controls. Observed spend is always computed from cost_events; no mutable
-- counters, so replays and corrections recompute cleanly.

CREATE TABLE IF NOT EXISTS budget_policies (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'account' CHECK (scope_type IN ('account', 'project')),
  scope_id TEXT,                 -- projects.id for project scope; NULL for account
  metric TEXT NOT NULL DEFAULT 'billed_cents',
  window_kind TEXT NOT NULL DEFAULT 'calendar_month_utc' CHECK (window_kind IN ('calendar_month_utc', 'lifetime')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'usd',
  warn_percents TEXT NOT NULL DEFAULT '[50,80,95]',
  hard_stop_enabled INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- One active policy per account/scope pair; raising or retargeting updates
-- the row in place rather than stacking policies.
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_policies_active_scope
  ON budget_policies(account_id, scope_type, IFNULL(scope_id, ''))
  WHERE is_active = 1;

CREATE INDEX IF NOT EXISTS idx_budget_policies_scope
  ON budget_policies(account_id, scope_type, scope_id);

CREATE TABLE IF NOT EXISTS cost_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT,
  tool_name TEXT NOT NULL,
  provider TEXT NOT NULL,          -- 'dataforseo' | 'openrouter' | 'pagespeed' | ...
  billed_cents INTEGER NOT NULL DEFAULT 0,  -- 0 for BYOK
  credit_class TEXT NOT NULL,      -- 'free' | 'paid' (McpCreditClass)
  source TEXT NOT NULL DEFAULT 'rate_card',  -- 'rate_card' | 'credit_class' | ...
  run_id TEXT,                     -- provenance link when inside a run
  created_at INTEGER NOT NULL     -- worker epoch ms; UTC month window derives from this
);

CREATE INDEX IF NOT EXISTS idx_cost_events_account_window
  ON cost_events(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cost_events_project
  ON cost_events(project_id);

CREATE TABLE IF NOT EXISTS budget_incidents (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL REFERENCES budget_policies(id),
  account_id TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT,
  window_start INTEGER NOT NULL,   -- lifetime windows use policy created_at
  window_end INTEGER,              -- NULL for lifetime
  threshold_percent INTEGER NOT NULL,
  threshold_kind TEXT NOT NULL CHECK (threshold_kind IN ('soft', 'hard')),
  amount_limit_cents INTEGER NOT NULL,
  amount_observed_cents INTEGER NOT NULL,
  approval_request_id TEXT,        -- mcp_action_requests.id for hard stops
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

-- One open incident per policy, threshold, and window: no duplicate alerts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_incidents_open
  ON budget_incidents(policy_id, threshold_percent, window_start)
  WHERE status = 'open';
