-- Weekly visibility email: opt-in on the user, one send per account per ISO week,
-- and the last homepage read so the next email can say what changed.

ALTER TABLE users ADD COLUMN weekly_report_opt_in_at INTEGER;

CREATE TABLE IF NOT EXISTS weekly_report_sends (
  account_id TEXT NOT NULL,
  week_key TEXT NOT NULL,
  sent_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, week_key)
);

CREATE TABLE IF NOT EXISTS weekly_visibility_reads (
  account_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  read_at INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  PRIMARY KEY (account_id, domain)
);
