-- Industry choice and multi-client workspaces.
-- Idempotent: tables use IF NOT EXISTS, and the backfill uses INSERT OR IGNORE
-- so a second run does not overwrite an industry someone already chose.
-- Existing accounts and projects stay on real_estate_agency, which is today's behaviour.
-- Rollback: DROP TABLE project_industries; DROP TABLE account_industries;
-- DROP TABLE client_workspace_members; DROP TABLE client_workspaces;

CREATE TABLE IF NOT EXISTS account_industries (
  account_id TEXT PRIMARY KEY,
  industry_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO account_industries (account_id, industry_id, updated_at)
SELECT account_id, 'real_estate_agency', CAST(strftime('%s', 'now') AS INTEGER) * 1000
FROM users
WHERE account_id IS NOT NULL AND account_id != '';

CREATE TABLE IF NOT EXISTS project_industries (
  project_id TEXT PRIMARY KEY,
  industry_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO project_industries (project_id, industry_id, updated_at)
SELECT id, 'real_estate_agency', updated_at FROM projects;

CREATE TABLE IF NOT EXISTS client_workspaces (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  display_name TEXT,
  logo_url TEXT,
  primary_colour TEXT,
  report_domain TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS client_workspace_members (
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  user_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner', 'staff', 'client_viewer')),
  client_id TEXT,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active')),
  invited_at INTEGER NOT NULL,
  accepted_at INTEGER,
  PRIMARY KEY (workspace_id, email),
  FOREIGN KEY (workspace_id) REFERENCES client_workspaces(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_client_workspace_members_user
  ON client_workspace_members(user_id);
