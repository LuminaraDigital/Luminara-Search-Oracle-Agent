-- Canonical billing/workspace account shared by Telegram + Firebase logins.
-- users.id stays the login identity (telegram numeric id or fb:{uid}).
-- users.account_id is what subscriptions (sub:{account_id}) and workspace use.

ALTER TABLE users ADD COLUMN account_id TEXT;

-- Backfill: each existing row is its own account until linked.
UPDATE users SET account_id = id WHERE account_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_users_account_id ON users(account_id);

-- Per-account product memory (DNA, VFS, audits, chat, optional BYOK key bag).
CREATE TABLE IF NOT EXISTS user_workspace (
  account_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
