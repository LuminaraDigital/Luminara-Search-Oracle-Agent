-- 0010: additive only. No existing table or column is altered or renamed.
--
-- 1. run_provenance: one row per agent invocation chain link. Every surface
--    (oracle chat, queued audit, sentinel cron, MCP tool, crawler) that does
--    agent work opens a run here so operators can trace cause -> effect
--    (sentinel spawned audit spawned oracle summary) after the fact.
CREATE TABLE IF NOT EXISTS run_provenance (
  run_id TEXT PRIMARY KEY,
  parent_run_id TEXT REFERENCES run_provenance(run_id),
  surface TEXT NOT NULL,
  account_id TEXT,
  org_id TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  wake_reason TEXT,
  wake_comment TEXT,
  input_hash TEXT,
  status TEXT NOT NULL DEFAULT 'running'
);
CREATE INDEX IF NOT EXISTS idx_run_provenance_parent ON run_provenance(parent_run_id);
CREATE INDEX IF NOT EXISTS idx_run_provenance_account_started ON run_provenance(account_id, started_at);
CREATE INDEX IF NOT EXISTS idx_run_provenance_status ON run_provenance(status, started_at);

-- 2. agent_skills: methodology prompts as versioned data instead of hardcoded
--    strings. The agent reads the latest enabled version per skill_slug at
--    runtime; bundled prompts remain the fallback when D1 is empty or the DB
--    is unavailable (honesty invariant: never silently run a degraded prompt).
CREATE TABLE IF NOT EXISTS agent_skills (
  skill_slug TEXT NOT NULL,
  version INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  prompt_body TEXT NOT NULL,
  model_hint TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  notes TEXT,
  PRIMARY KEY (skill_slug, version)
);
CREATE INDEX IF NOT EXISTS idx_agent_skills_enabled ON agent_skills(skill_slug, enabled, version);
