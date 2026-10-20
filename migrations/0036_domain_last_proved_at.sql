-- Domain proof time for Signed Audit Receipt freshness.
-- Luminara Suite D1 Migration 0036
-- last_checked_at moves on a scheduled attempt. A failed manual check used to
-- move it too, which kept a domain looking fresh and hid it from the re-check.
-- last_proved_at moves only when the proof is found.

ALTER TABLE domain_verifications ADD COLUMN last_proved_at TEXT;

-- Rows with no failures take their last check as the proof time. A row that
-- already failed stays unproved until the next successful check.
UPDATE domain_verifications
   SET last_proved_at = last_checked_at
 WHERE status = 'verified'
   AND consecutive_failures = 0
   AND last_proved_at IS NULL
   AND last_checked_at IS NOT NULL;
