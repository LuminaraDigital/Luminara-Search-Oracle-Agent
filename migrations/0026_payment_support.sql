-- Track SW, SW0a-16: payment support reaches a person.
-- /paysupport used to send one canned message, and the buyer's reply went to the model chat.
-- /paysupport now writes an 'awaiting' row that expires in 10 minutes; that row is the window.
-- The buyer's next message inside it fills `message` and moves the row to 'open' in one
-- conditional update, and the bot forwards it to the ids in TELEGRAM_ADMIN_ID. An admin's
-- /reply moves it to 'answered'; /close moves it to 'closed'.
-- For an 'open' row, expires_at is the end of the 10 minutes in which further messages from the
-- buyer are added to the same request.
-- An 'awaiting' row past its expires_at is deleted by the daily sweep. Rows are exported and
-- deleted with the account.

CREATE TABLE IF NOT EXISTS payment_support_requests (
  id TEXT PRIMARY KEY,
  payer_tg_id INTEGER NOT NULL,
  account_id TEXT,
  charge_id TEXT,
  message TEXT CHECK (message IS NULL OR length(message) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'awaiting' CHECK (status IN ('awaiting','open','answered','closed')),
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (status = 'awaiting' OR message IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_payment_support_open ON payment_support_requests(created_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_payment_support_awaiting ON payment_support_requests(payer_tg_id) WHERE status = 'awaiting';
CREATE INDEX IF NOT EXISTS idx_payment_support_account ON payment_support_requests(account_id);
