-- Track SW, SW0a-3: a paid Telegram Stars charge can never be lost.
-- One row per charge, written before anything else is done with the payment. A charge is always
-- on record, and always ends credited or refunded. worker/starsCharges.ts owns every transition:
--
--   received -> credited -> refund_due            (a manual refund)
--   received -> refund_due -> refunded
--                          \-> refund_failed -> refund_due   (5 attempts; an operator retries it)
--
-- payer_tg_id is the Telegram account that paid. A refund is only ever sent to it.
-- stars_returned is 1 once the Stars are known to be back with the payer. A row can stay refund_due
-- after that, while what the charge gave is still being taken back; Telegram is not asked again.
-- account_id is NULL when the payer has no account row, and is set to NULL on account deletion:
-- the row is kept as a financial record.

CREATE TABLE IF NOT EXISTS stars_charges (
  charge_id TEXT PRIMARY KEY,
  payer_tg_id INTEGER NOT NULL,
  account_id TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('plan','job','unknown')),
  ref_id TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars > 0),
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received','credited','refund_due','refunded','refund_failed')),
  refund_reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  stars_returned INTEGER NOT NULL DEFAULT 0 CHECK (stars_returned IN (0, 1)),
  lease_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stars_charges_received ON stars_charges(created_at) WHERE status = 'received';
CREATE INDEX IF NOT EXISTS idx_stars_charges_due ON stars_charges(updated_at) WHERE status = 'refund_due';
CREATE INDEX IF NOT EXISTS idx_stars_charges_account ON stars_charges(account_id, created_at);
