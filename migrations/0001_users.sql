-- Luminara app users (Telegram Mini App and/or Firebase Auth)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('telegram', 'firebase')),
  email TEXT,
  display_name TEXT,
  telegram_id TEXT,
  firebase_uid TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_firebase_uid ON users(firebase_uid);
CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen_at);
