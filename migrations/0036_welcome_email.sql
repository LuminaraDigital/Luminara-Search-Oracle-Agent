-- Welcome email idempotency and one-click unsubscribe.
-- Rows that already exist are stamped so this ship does not mail the whole list.
-- A row inserted after this migration leaves welcome_sent_at null until the send claims it.

ALTER TABLE users ADD COLUMN welcome_sent_at INTEGER;
ALTER TABLE users ADD COLUMN email_opt_out_at INTEGER;
ALTER TABLE users ADD COLUMN email_unsub_token TEXT;

UPDATE users SET welcome_sent_at = created_at WHERE welcome_sent_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unsub_token
  ON users(email_unsub_token) WHERE email_unsub_token IS NOT NULL;
