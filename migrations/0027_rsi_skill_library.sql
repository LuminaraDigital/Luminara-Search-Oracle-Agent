-- Learned SKILL.md records for recursive self-improvement.
-- Distinct from agent_skills, which stores the Oracle runtime prompt.

CREATE TABLE IF NOT EXISTS rsi_skills (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'active',
  pinned INTEGER NOT NULL DEFAULT 0,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  usage_count INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  stale_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER,
  CHECK (state IN ('active', 'stale', 'archived')),
  CHECK (pinned IN (0, 1))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rsi_skills_live_slug
  ON rsi_skills(account_id, slug) WHERE state != 'archived';
CREATE INDEX IF NOT EXISTS idx_rsi_skills_account
  ON rsi_skills(account_id, state, updated_at DESC);

CREATE TABLE IF NOT EXISTS rsi_skill_revisions (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  state TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  change_kind TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  guard_ok INTEGER NOT NULL DEFAULT 0,
  evals_ok INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  CHECK (change_kind IN ('create', 'patch', 'archive', 'restore', 'curate_stale', 'pin', 'unpin')),
  CHECK (state IN ('active', 'stale', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_rsi_skill_revisions_skill
  ON rsi_skill_revisions(skill_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_rsi_skill_revisions_round
  ON rsi_skill_revisions(account_id, created_at);

CREATE TABLE IF NOT EXISTS rsi_fix_observations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  signature TEXT NOT NULL,
  title TEXT NOT NULL,
  outcome TEXT NOT NULL,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  CHECK (outcome IN ('success', 'failure'))
);

CREATE INDEX IF NOT EXISTS idx_rsi_fix_observations_signature
  ON rsi_fix_observations(account_id, signature, outcome, created_at);

CREATE TABLE IF NOT EXISTS rsi_skill_proposals (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_skill_id TEXT,
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  success_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  block_reason TEXT,
  created_at INTEGER NOT NULL,
  CHECK (kind IN ('create', 'patch')),
  CHECK (status IN ('pending', 'applied', 'rejected', 'blocked'))
);

CREATE INDEX IF NOT EXISTS idx_rsi_skill_proposals_account
  ON rsi_skill_proposals(account_id, status, created_at DESC);
