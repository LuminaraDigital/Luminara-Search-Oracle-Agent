-- Agent MCP Product Surface (APS A1-A3)
-- Projects, project memory, agent reports, API key usage touch-up.

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  default_location_code TEXT,
  default_language_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (account_id, domain, client_id)
);

CREATE INDEX IF NOT EXISTS idx_projects_account ON projects(account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_context_sections (
  project_id TEXT NOT NULL,
  key TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (project_id, key),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_competitors (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  name TEXT,
  notes TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  UNIQUE (project_id, domain),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_key_pages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  url TEXT NOT NULL,
  role TEXT NOT NULL,
  topic TEXT,
  notes TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  UNIQUE (project_id, url),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS project_research_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  entry_date TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_research_log_project
  ON project_research_log(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  html TEXT NOT NULL,
  skill TEXT,
  created_by_label TEXT,
  created_by_user_id TEXT,
  size_bytes INTEGER NOT NULL,
  share_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (project_id, title),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_agent_reports_project
  ON agent_reports(project_id, updated_at DESC);
