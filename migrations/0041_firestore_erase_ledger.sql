-- Tombstone and retry queue for a Firestore privacy erase.
-- status is pending or done. Backfill skips every account_id and login id here.
-- pending is retried by reconcile. done stays so an old export cannot recreate the user.

CREATE TABLE IF NOT EXISTS firestore_erase_ledger (
  account_id TEXT PRIMARY KEY,
  user_ids_json TEXT NOT NULL,
  status TEXT NOT NULL,
  code TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
