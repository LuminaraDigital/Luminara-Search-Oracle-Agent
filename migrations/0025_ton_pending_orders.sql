-- Track SW, SW0a-5: a TON order is remembered for 48 hours, not 2.
-- The KV copy of an order expires after 2 hours. A transfer the chain index shows late was then
-- paid and never credited. This row holds what the verifier needs after the KV copy has gone,
-- so the buyer's own retry and the daily sweep can still credit it.
-- Rows are deleted at expires_at (48 hours after creation), and with the account.

CREATE TABLE IF NOT EXISTS ton_pending_orders (
  order_id TEXT PRIMARY KEY,
  memo TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL,
  login_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  asset TEXT NOT NULL DEFAULT 'TON',
  amount_nano TEXT NOT NULL,
  recipient TEXT NOT NULL,
  network TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','credited','expired')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ton_pending_open ON ton_pending_orders(expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_ton_pending_account ON ton_pending_orders(account_id);
