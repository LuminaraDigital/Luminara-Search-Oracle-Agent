-- Weekly email digest (spec 0031). Opt-in: a null weekly_digest_opt_in_at means off.
-- weekly_digest_opt_in_at and weekly_digest_email are the consent record: when, and for which verified address.
-- The digest goes out only while users.email still matches weekly_digest_email.
-- weekly_digest_tz is the browser's IANA zone; null means Australia/Sydney.
-- email_digest_sends holds one claim per user and local ISO week, so a retried run never mails twice.

ALTER TABLE users ADD COLUMN weekly_digest_opt_in_at INTEGER;
ALTER TABLE users ADD COLUMN weekly_digest_email TEXT;
ALTER TABLE users ADD COLUMN weekly_digest_tz TEXT;

CREATE INDEX IF NOT EXISTS idx_users_weekly_digest
  ON users(weekly_digest_opt_in_at) WHERE weekly_digest_opt_in_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_digest_sends (
  user_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'sent', 'skipped', 'unknown')),
  kind TEXT CHECK (kind IS NULL OR kind IN ('update', 'quiet')),
  claimed_at INTEGER NOT NULL,
  sent_at INTEGER,
  PRIMARY KEY (user_id, week_key)
);

CREATE INDEX IF NOT EXISTS idx_email_digest_sends_user_claimed
  ON email_digest_sends(user_id, claimed_at DESC);
