-- Domain proof time for Signed Audit Receipt freshness.
-- Luminara Suite D1 Migration 0036
-- last_checked_at moves on a scheduled attempt. last_proved_at moves only when
-- the proof is found. This file does not copy last_checked_at. Every existing
-- domain stays unproved until a manual Check or the scheduled re-check finds
-- the token again. Until then minting returns DOMAIN_CHECK_STALE.

ALTER TABLE domain_verifications ADD COLUMN last_proved_at TEXT;
