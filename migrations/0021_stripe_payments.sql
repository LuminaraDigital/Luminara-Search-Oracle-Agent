-- Stripe checkout & subscription ledger
-- Luminara Suite D1 Migration 0021
-- Prevents duplicate crediting of Stripe checkout sessions and webhook events.

CREATE TABLE IF NOT EXISTS stripe_credited_sessions (
  session_id TEXT PRIMARY KEY,
  customer_id TEXT,
  account_id TEXT,
  plan_id TEXT NOT NULL,
  amount_total INTEGER NOT NULL,
  currency TEXT NOT NULL,
  credited_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stripe_account ON stripe_credited_sessions(account_id);
