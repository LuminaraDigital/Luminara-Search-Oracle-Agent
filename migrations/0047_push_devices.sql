-- Android push registrations for agent notifications (sign-offs, call-backs). Optional: sending is a no-op when FCM is unconfigured.
CREATE TABLE IF NOT EXISTS push_devices (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('android')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_push_devices_account ON push_devices (account_id);
