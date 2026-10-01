-- Phase 2: opaque invite codes, one attribution per referred account,
-- two-sided hosted scout credits, weekly missions, and Visibility Level.
-- Codes are public tokens. code_hash is sha256("luminara-ref:" || code).
-- week_scout_* counts honest scouts inside the current ISO week so re-scout
-- needs a second run that week. scout_receipts holds one-time Worker attestations
-- (token_hash is sha256("luminara-scout-receipt:" || token)). The raw token is
-- returned once on the evidence response and is not stored.
-- Do not apply remotely until an operator says yes. This file is still unapplied.
--   npm run db:migrate:local
--   npm run db:migrate:staging
--   npm run db:migrate

CREATE TABLE IF NOT EXISTS referral_codes (
  account_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS referral_attributions (
  referred_account_id TEXT PRIMARY KEY,
  referrer_account_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attributed_at INTEGER NOT NULL,
  qualified_at INTEGER,
  CHECK (referred_account_id <> referrer_account_id)
);

CREATE INDEX IF NOT EXISTS idx_referral_attributions_referrer
  ON referral_attributions(referrer_account_id, attributed_at DESC);

CREATE TABLE IF NOT EXISTS referral_rewards (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  remaining INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (account_id, reason)
);

CREATE INDEX IF NOT EXISTS idx_referral_rewards_fifo
  ON referral_rewards(account_id, kind, created_at, id);

CREATE TABLE IF NOT EXISTS user_progression (
  account_id TEXT PRIMARY KEY,
  streak_weeks INTEGER NOT NULL DEFAULT 0,
  last_mission_week TEXT,
  last_mission_at INTEGER,
  visibility_level TEXT NOT NULL DEFAULT 'explorer',
  honest_scout_count INTEGER NOT NULL DEFAULT 0,
  last_honest_scout_day TEXT,
  week_scout_key TEXT,
  week_scout_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- One-time attestations minted when the Worker sees a signed-in scout evidence call.
-- consumed_at is set by a single conditional UPDATE so two isolates cannot both spend it.
CREATE TABLE IF NOT EXISTS scout_receipts (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  minted_at INTEGER NOT NULL,
  consumed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_scout_receipts_account
  ON scout_receipts(account_id, minted_at);

CREATE TABLE IF NOT EXISTS user_missions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  mission_key TEXT NOT NULL,
  week_key TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  UNIQUE (account_id, mission_key, week_key)
);

CREATE INDEX IF NOT EXISTS idx_user_missions_account
  ON user_missions(account_id, week_key);
