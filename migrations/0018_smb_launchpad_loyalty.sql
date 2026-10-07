-- SMB Launchpad: closed-loop loyalty vouchers + milestone pre-order campaigns
-- Luminara Suite D1 Migration 0018
-- Non-custodial: this database stores campaign copy, the merchant-registered contract
-- address, and voucher redemption records. It never stores keys or balances.
-- Amounts raised are read on-chain; there is deliberately no "raised" column.

CREATE TABLE IF NOT EXISTS launchpad_campaigns (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  domain TEXT,
  business_name TEXT NOT NULL,
  abn_nzbn TEXT,
  country TEXT NOT NULL DEFAULT 'AU',            -- 'AU' | 'NZ'
  campaign_type TEXT NOT NULL,                  -- 'closed_loop_loyalty' | 'milestone_preorder'
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  compliance_status TEXT NOT NULL,              -- 'approved' | 'flagged' | 'rejected' (rule-based screen)
  compliance_details TEXT,                      -- JSON ComplianceScanResult
  chain TEXT NOT NULL DEFAULT 'xdc',            -- 'xdc' | 'polygon'
  network TEXT NOT NULL DEFAULT 'testnet',      -- 'testnet' | 'mainnet'
  token_name TEXT,
  token_symbol TEXT,
  contract_address TEXT,                        -- token (loyalty) or escrow (pre-order), set by merchant after deploy
  contract_tx_hash TEXT,
  target_fiat_cents INTEGER NOT NULL DEFAULT 0, -- display target only, not a measured amount
  fiat_currency TEXT NOT NULL DEFAULT 'AUD',    -- 'AUD' | 'NZD'
  voucher_expiry_months INTEGER,                -- NULL = no expiry; otherwise >= 36 (ACL gift card minimum)
  terms_accepted_at TEXT NOT NULL,
  listed_at TEXT,                               -- set when contract_address is registered; only listed rows are public
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_launchpad_campaigns_account ON launchpad_campaigns(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_launchpad_campaigns_listed ON launchpad_campaigns(listed_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_launchpad_campaigns_contract
  ON launchpad_campaigns(chain, network, contract_address) WHERE contract_address IS NOT NULL;

CREATE TABLE IF NOT EXISTS launchpad_milestones (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES launchpad_campaigns(id) ON DELETE CASCADE,
  milestone_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  payout_percentage INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (campaign_id, milestone_index)
);

CREATE TABLE IF NOT EXISTS launchpad_vouchers (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES launchpad_campaigns(id) ON DELETE CASCADE,
  voucher_code TEXT NOT NULL UNIQUE,
  customer_ref TEXT,                            -- optional wallet address or merchant's own reference
  item_description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued',        -- 'issued' | 'redeemed' | 'cancelled'
  issued_by_account_id TEXT NOT NULL,
  redeemed_by_account_id TEXT,
  redeem_tx_hash TEXT,
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  redeemed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_launchpad_vouchers_campaign ON launchpad_vouchers(campaign_id, issued_at);

CREATE TABLE IF NOT EXISTS launchpad_subscriptions (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES launchpad_campaigns(id) ON DELETE CASCADE,
  subscriber_ref TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'email',
  wallet_address TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (campaign_id, subscriber_ref)
);

CREATE INDEX IF NOT EXISTS idx_launchpad_subscriptions_campaign ON launchpad_subscriptions(campaign_id);

CREATE TABLE IF NOT EXISTS launchpad_snapshots (
  campaign_id TEXT PRIMARY KEY REFERENCES launchpad_campaigns(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  current_milestone INTEGER NOT NULL DEFAULT 0,
  snapshot_json TEXT NOT NULL,
  last_notified_milestone INTEGER NOT NULL DEFAULT -1,
  updated_at TEXT NOT NULL
);
