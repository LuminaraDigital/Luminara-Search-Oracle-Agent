-- Domain proof time for Signed Audit Receipt freshness.
-- Luminara Suite D1 Migration 0039
-- last_checked_at moves on a scheduled attempt. last_proved_at moves only when
-- the proof is found. This file does not copy last_checked_at. Every existing
-- domain stays unproved until a manual Check or the scheduled re-check finds
-- the token again. Until then minting returns DOMAIN_CHECK_STALE.
-- PR #182 called this 0036. 0036 through 0038 are already used on staging.

ALTER TABLE domain_verifications ADD COLUMN last_proved_at TEXT;
