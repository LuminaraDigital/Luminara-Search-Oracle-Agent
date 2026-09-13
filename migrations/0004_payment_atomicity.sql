-- Payment atomicity ledger (security plan P1-4)
-- Luminara Suite D1 Migration 0004
-- D1 constraints decide whether a license key, TON transaction or Stars charge was already granted.
-- KV keeps the license/order records and acts as the read cache.

-- One row per license key. CHECK makes an over-limit claim fail, which rolls back the whole claim batch.
CREATE TABLE IF NOT EXISTS license_key_claims (
  license_key TEXT PRIMARY KEY,
  claim_count INTEGER NOT NULL DEFAULT 0,
  max_claims INTEGER NOT NULL CHECK (max_claims >= 1),
  updated_at INTEGER NOT NULL,
  CHECK (claim_count >= 0 AND claim_count <= max_claims)
);

-- An account can redeem a given key at most once (matters for multi-use campaign keys).
CREATE TABLE IF NOT EXISTS license_redemptions (
  license_key TEXT NOT NULL,
  account_id TEXT NOT NULL,
  redeemed_at INTEGER NOT NULL,
  PRIMARY KEY (license_key, account_id)
);

-- One promotional trial per account.
CREATE TABLE IF NOT EXISTS license_trial_claims (
  account_id TEXT PRIMARY KEY,
  license_key TEXT NOT NULL,
  claimed_at INTEGER NOT NULL
);

-- A TON transaction credits one order, and an order is credited once.
CREATE TABLE IF NOT EXISTS ton_credited_tx (
  tx_hash TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE,
  account_id TEXT,
  credited_at INTEGER NOT NULL
);

-- A Telegram Stars charge credits once.
CREATE TABLE IF NOT EXISTS stars_credited_charges (
  charge_id TEXT PRIMARY KEY,
  account_id TEXT,
  credited_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_license_redemptions_account ON license_redemptions(account_id);
CREATE INDEX IF NOT EXISTS idx_ton_credited_tx_account ON ton_credited_tx(account_id);
