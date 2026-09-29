-- Phase 3: Idea Scout cards and Niche Pulse storage.
-- idea_scouts holds the honesty-checked card JSON. No percentage columns.
-- linked_audit_run_id is set only when an audit_runs row for this account exists.
-- niche_pulse_subs stores the last niche and one tip. The bot answers /pulse.
-- idea_scout_daily is the free-card counter. Claim it with compare-and-swap
-- (UPDATE ... WHERE used = expected) only after idea_scouts insert succeeds.
-- A daily cron is not enabled in this migration.
-- Do not apply remotely until an operator says yes. This file is still unapplied.
--   npm run db:migrate:local
--   npm run db:migrate:staging
--   npm run db:migrate

CREATE TABLE IF NOT EXISTS idea_scouts (
  id TEXT PRIMARY KEY,
  account_id TEXT,
  idea_text TEXT NOT NULL,
  niche TEXT,
  competitor_urls_json TEXT NOT NULL,
  card_json TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  linked_domain TEXT,
  linked_audit_run_id TEXT,
  CHECK (status IN ('ready', 'linked'))
);

CREATE INDEX IF NOT EXISTS idx_idea_scouts_account
  ON idea_scouts(account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS idea_scout_daily (
  account_id TEXT NOT NULL,
  utc_day TEXT NOT NULL,
  used INTEGER NOT NULL,
  PRIMARY KEY (account_id, utc_day)
);

CREATE TABLE IF NOT EXISTS niche_pulse_subs (
  account_id TEXT PRIMARY KEY,
  niche TEXT NOT NULL,
  last_tip TEXT,
  last_sent_at INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
