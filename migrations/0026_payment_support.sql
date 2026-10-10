-- Track SW, SW0a-16: payment support reaches a person.
-- /paysupport used to send one canned message, and the buyer's reply went to the model chat.
-- /paysupport now writes an 'awaiting' row that expires in 10 minutes; that row is the window.
-- The buyer's next message inside it fills `message` and moves the row to 'open' in one
-- conditional update, and the bot forwards it to the ids in TELEGRAM_ADMIN_ID. An admin's
-- /reply moves it to 'answered'; /close moves it to 'closed'.
--
-- expires_at is the end of whichever window the row is in:
--   awaiting  the 10 minutes after /paysupport;
--   open      the 10 minutes in which further messages from the buyer are added to the request;
--   answered  the 72 hours in which the buyer's next message returns to the request, so that a
--             reply to a person is not answered by a model.
-- follow_ups counts the messages added since the request was opened or last answered. The code
-- stops adding, and stops forwarding to the admins, at 5.
--
-- An 'awaiting' row past its expires_at is deleted by the daily sweep. An 'answered' or
-- 'closed' row is deleted 12 months after it was last touched. Rows are exported and deleted
-- with the account.
--
-- Two additions to the table as first written in the plan, both from review: the follow_ups
-- column, and one index on (payer_tg_id, status, expires_at) in place of the partial index on
-- awaiting rows, because the lookup made for every chat message asks for three statuses.

CREATE TABLE IF NOT EXISTS payment_support_requests (
  id TEXT PRIMARY KEY,
  payer_tg_id INTEGER NOT NULL,
  account_id TEXT,
  charge_id TEXT,
  message TEXT CHECK (message IS NULL OR length(message) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'awaiting' CHECK (status IN ('awaiting','open','answered','closed')),
  follow_ups INTEGER NOT NULL DEFAULT 0 CHECK (follow_ups >= 0),
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (status = 'awaiting' OR message IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_payment_support_open ON payment_support_requests(created_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_payment_support_payer ON payment_support_requests(payer_tg_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_payment_support_account ON payment_support_requests(account_id);
