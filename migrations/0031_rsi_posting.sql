-- Selected posts, 24h and 72h engagement, and weekly playbook edits.

CREATE TABLE IF NOT EXISTS rsi_posts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  pattern_key TEXT NOT NULL,
  hook TEXT NOT NULL,
  body TEXT NOT NULL,
  prediction TEXT NOT NULL,
  prediction_evidence TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'selected',
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  CHECK (prediction IN ('measured', 'not_measured')),
  CHECK (status IN ('selected', 'recorded'))
);

CREATE INDEX IF NOT EXISTS idx_rsi_posts_brand
  ON rsi_posts(account_id, brand_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rsi_post_metrics (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  horizon TEXT NOT NULL,
  impressions REAL,
  engagements REAL,
  measurement_status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (post_id, horizon),
  CHECK (horizon IN ('24h', '72h')),
  CHECK (measurement_status IN ('measured', 'not_measured'))
);

CREATE TABLE IF NOT EXISTS rsi_post_reflections (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  patterns_added INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rsi_post_reflections_week
  ON rsi_post_reflections(account_id, brand_id, week_key);
