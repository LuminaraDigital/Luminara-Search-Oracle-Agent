-- Stripe card rail: map a refund or a dispute back to the plan days one charge granted.
-- Expand-only. Adds columns to stripe_credited_sessions (migration 0021); nothing is dropped or rewritten.
--
-- payment_intent   the id a charge.refunded or charge.dispute.* event carries.
-- user_id          the login id that paid, so both sub:{accountId} and sub:{loginId} can be rewritten.
-- granted_days     the days this charge added. 0 when the payment was refused and sent back.
-- granted_until    the plan expiry right after this grant: the end of the days this charge paid for.
--                  A reversal removes only the part of them that is still ahead.
-- prev_plan        the plan the account held before its current run of card purchases began,
--                  restored when no card charge that is still standing pays for a higher one.
-- reversed_at      set once, by whichever refund or dispute event arrives first.
-- reversal_reason  'refund' | 'dispute' | 'lower_plan_refused'.
--
-- A refund or dispute that arrives before its session was credited leaves a row of its own
-- (session_id 'reversed:<payment_intent>', granted_days 0), so the late session is never credited.
--
-- worker/paymentLedger.ts probes for these columns before a checkout session is created, so a
-- database without this migration takes no card payment.

ALTER TABLE stripe_credited_sessions ADD COLUMN payment_intent TEXT;
ALTER TABLE stripe_credited_sessions ADD COLUMN user_id TEXT;
ALTER TABLE stripe_credited_sessions ADD COLUMN granted_days INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stripe_credited_sessions ADD COLUMN granted_until INTEGER;
ALTER TABLE stripe_credited_sessions ADD COLUMN prev_plan TEXT;
ALTER TABLE stripe_credited_sessions ADD COLUMN reversed_at INTEGER;
ALTER TABLE stripe_credited_sessions ADD COLUMN reversal_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_payment_intent
  ON stripe_credited_sessions(payment_intent) WHERE payment_intent IS NOT NULL;
