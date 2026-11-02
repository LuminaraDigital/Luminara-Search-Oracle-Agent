-- Scoped review rules: an owner's correction becomes a durable rule for later agent runs.
-- Scope columns on memory_facts plus the memory_edges graph. Additive only.

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

-- valid_from .. valid_to keeps history when a relationship stops being true.
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
