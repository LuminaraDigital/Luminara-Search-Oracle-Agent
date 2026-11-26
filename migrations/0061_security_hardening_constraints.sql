-- Migration 0061: Non-destructive security hardening constraints and atomic slot state.
-- Adds SQLite BEFORE INSERT / BEFORE UPDATE validation triggers using RAISE(ABORT, ...)
-- across billing, quota, recovery, telemetry, memory vault, and launchpad tables.
-- Also adds account_id ownership on launchpad_subscriptions (M-03) and atomic
-- sentinel_target_slots reservation table (M-08/M-17).
-- Additive only; never drops or recreates existing tables.

-- M-03: Bind launchpad subscriptions to the authenticated account that created them.
ALTER TABLE launchpad_subscriptions ADD COLUMN account_id TEXT;
CREATE INDEX IF NOT EXISTS idx_launchpad_subscriptions_account
  ON launchpad_subscriptions(account_id, campaign_id);

-- M-08 / M-17: Atomic per-owner slot reservation for Drift Sentinel targets.
CREATE TABLE IF NOT EXISTS sentinel_target_slots (
  owner_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, domain)
);

-- M-13: referral_rewards (positive amount, 0 <= remaining <= amount)
CREATE TRIGGER IF NOT EXISTS trg_referral_rewards_bi
BEFORE INSERT ON referral_rewards
WHEN NEW.amount <= 0 OR NEW.remaining < 0 OR NEW.remaining > NEW.amount
BEGIN
  SELECT RAISE(ABORT, 'referral_rewards requires amount > 0 and 0 <= remaining <= amount');
END;

CREATE TRIGGER IF NOT EXISTS trg_referral_rewards_bu
BEFORE UPDATE ON referral_rewards
WHEN NEW.amount <= 0 OR NEW.remaining < 0 OR NEW.remaining > NEW.amount
BEGIN
  SELECT RAISE(ABORT, 'referral_rewards requires amount > 0 and 0 <= remaining <= amount');
END;

-- M-13: user_progression (non-negative counters)
CREATE TRIGGER IF NOT EXISTS trg_user_progression_bi
BEFORE INSERT ON user_progression
WHEN NEW.streak_weeks < 0 OR NEW.honest_scout_count < 0 OR NEW.week_scout_count < 0
BEGIN
  SELECT RAISE(ABORT, 'user_progression counters must be non-negative');
END;

CREATE TRIGGER IF NOT EXISTS trg_user_progression_bu
BEFORE UPDATE ON user_progression
WHEN NEW.streak_weeks < 0 OR NEW.honest_scout_count < 0 OR NEW.week_scout_count < 0
BEGIN
  SELECT RAISE(ABORT, 'user_progression counters must be non-negative');
END;

-- M-13: cost_events (non-negative billed_cents; 0 is valid for BYOK)
CREATE TRIGGER IF NOT EXISTS trg_cost_events_bi
BEFORE INSERT ON cost_events
WHEN NEW.billed_cents < 0
BEGIN
  SELECT RAISE(ABORT, 'cost_events.billed_cents must be non-negative');
END;

CREATE TRIGGER IF NOT EXISTS trg_cost_events_bu
BEFORE UPDATE ON cost_events
WHEN NEW.billed_cents < 0
BEGIN
  SELECT RAISE(ABORT, 'cost_events.billed_cents must be non-negative');
END;

-- M-13: budget_incidents (positive threshold/limit, non-negative observed spend)
CREATE TRIGGER IF NOT EXISTS trg_budget_incidents_bi
BEFORE INSERT ON budget_incidents
WHEN NEW.threshold_percent <= 0 OR NEW.amount_limit_cents <= 0 OR NEW.amount_observed_cents < 0
BEGIN
  SELECT RAISE(ABORT, 'budget_incidents requires positive threshold/limit and non-negative observed cents');
END;

CREATE TRIGGER IF NOT EXISTS trg_budget_incidents_bu
BEFORE UPDATE ON budget_incidents
WHEN NEW.threshold_percent <= 0 OR NEW.amount_limit_cents <= 0 OR NEW.amount_observed_cents < 0
BEGIN
  SELECT RAISE(ABORT, 'budget_incidents requires positive threshold/limit and non-negative observed cents');
END;

-- M-13: idea_scout_daily (non-negative daily usage counter)
CREATE TRIGGER IF NOT EXISTS trg_idea_scout_daily_bi
BEFORE INSERT ON idea_scout_daily
WHEN NEW.used < 0
BEGIN
  SELECT RAISE(ABORT, 'idea_scout_daily.used must be non-negative');
END;

CREATE TRIGGER IF NOT EXISTS trg_idea_scout_daily_bu
BEFORE UPDATE ON idea_scout_daily
WHEN NEW.used < 0
BEGIN
  SELECT RAISE(ABORT, 'idea_scout_daily.used must be non-negative');
END;

-- M-13: invoice_reconcile_runs (non-negative cents and period_start < period_end)
CREATE TRIGGER IF NOT EXISTS trg_invoice_reconcile_runs_bi
BEFORE INSERT ON invoice_reconcile_runs
WHEN NEW.internal_cents < 0 OR NEW.invoice_cents < 0 OR NEW.delta_cents < 0 OR NEW.period_end <= NEW.period_start
BEGIN
  SELECT RAISE(ABORT, 'invoice_reconcile_runs requires non-negative cents and period_start < period_end');
END;

CREATE TRIGGER IF NOT EXISTS trg_invoice_reconcile_runs_bu
BEFORE UPDATE ON invoice_reconcile_runs
WHEN NEW.internal_cents < 0 OR NEW.invoice_cents < 0 OR NEW.delta_cents < 0 OR NEW.period_end <= NEW.period_start
BEGIN
  SELECT RAISE(ABORT, 'invoice_reconcile_runs requires non-negative cents and period_start < period_end');
END;

-- M-13: stripe_credited_sessions (non-negative amount_total and granted_days; 0 allowed for reversal markers)
CREATE TRIGGER IF NOT EXISTS trg_stripe_credited_sessions_bi
BEFORE INSERT ON stripe_credited_sessions
WHEN NEW.amount_total < 0 OR NEW.granted_days < 0
BEGIN
  SELECT RAISE(ABORT, 'stripe_credited_sessions requires non-negative amount_total and granted_days');
END;

CREATE TRIGGER IF NOT EXISTS trg_stripe_credited_sessions_bu
BEFORE UPDATE ON stripe_credited_sessions
WHEN NEW.amount_total < 0 OR NEW.granted_days < 0
BEGIN
  SELECT RAISE(ABORT, 'stripe_credited_sessions requires non-negative amount_total and granted_days');
END;

-- M-13: stars_charges (positive stars, non-negative attempts)
CREATE TRIGGER IF NOT EXISTS trg_stars_charges_bi
BEFORE INSERT ON stars_charges
WHEN NEW.stars <= 0 OR NEW.attempts < 0
BEGIN
  SELECT RAISE(ABORT, 'stars_charges requires stars > 0 and attempts >= 0');
END;

CREATE TRIGGER IF NOT EXISTS trg_stars_charges_bu
BEFORE UPDATE ON stars_charges
WHEN NEW.stars <= 0 OR NEW.attempts < 0
BEGIN
  SELECT RAISE(ABORT, 'stars_charges requires stars > 0 and attempts >= 0');
END;

-- M-13: ton_pending_orders (positive integer amount_nano string and expires_at > created_at)
CREATE TRIGGER IF NOT EXISTS trg_ton_pending_orders_bi
BEFORE INSERT ON ton_pending_orders
WHEN NEW.amount_nano = ''
  OR NEW.amount_nano GLOB '*[^0-9]*'
  OR LTRIM(NEW.amount_nano, '0') = ''
  OR NEW.expires_at <= NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'ton_pending_orders requires positive numeric amount_nano and expires_at > created_at');
END;

CREATE TRIGGER IF NOT EXISTS trg_ton_pending_orders_bu
BEFORE UPDATE ON ton_pending_orders
WHEN NEW.amount_nano = ''
  OR NEW.amount_nano GLOB '*[^0-9]*'
  OR LTRIM(NEW.amount_nano, '0') = ''
  OR NEW.expires_at <= NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'ton_pending_orders requires positive numeric amount_nano and expires_at > created_at');
END;

-- M-13: recovery_runs (bounded step_index 0..2)
CREATE TRIGGER IF NOT EXISTS trg_recovery_runs_bi
BEFORE INSERT ON recovery_runs
WHEN NEW.step_index < 0 OR NEW.step_index > 2
BEGIN
  SELECT RAISE(ABORT, 'recovery_runs.step_index must be between 0 and 2');
END;

CREATE TRIGGER IF NOT EXISTS trg_recovery_runs_bu
BEFORE UPDATE ON recovery_runs
WHEN NEW.step_index < 0 OR NEW.step_index > 2
BEGIN
  SELECT RAISE(ABORT, 'recovery_runs.step_index must be between 0 and 2');
END;

-- M-13: memory_vault_snapshots (non-negative leaf_count)
CREATE TRIGGER IF NOT EXISTS trg_memory_vault_snapshots_bi
BEFORE INSERT ON memory_vault_snapshots
WHEN NEW.leaf_count < 0
BEGIN
  SELECT RAISE(ABORT, 'memory_vault_snapshots.leaf_count must be non-negative');
END;

CREATE TRIGGER IF NOT EXISTS trg_memory_vault_snapshots_bu
BEFORE UPDATE ON memory_vault_snapshots
WHEN NEW.leaf_count < 0
BEGIN
  SELECT RAISE(ABORT, 'memory_vault_snapshots.leaf_count must be non-negative');
END;

-- M-13: agent_trace_spans (non-negative token, cost, and latency metrics)
CREATE TRIGGER IF NOT EXISTS trg_agent_trace_spans_bi
BEFORE INSERT ON agent_trace_spans
WHEN NEW.input_tokens < 0 OR NEW.output_tokens < 0 OR NEW.cost_cents < 0 OR NEW.latency_ms < 0
BEGIN
  SELECT RAISE(ABORT, 'agent_trace_spans metrics must be non-negative');
END;

CREATE TRIGGER IF NOT EXISTS trg_agent_trace_spans_bu
BEFORE UPDATE ON agent_trace_spans
WHEN NEW.input_tokens < 0 OR NEW.output_tokens < 0 OR NEW.cost_cents < 0 OR NEW.latency_ms < 0
BEGIN
  SELECT RAISE(ABORT, 'agent_trace_spans metrics must be non-negative');
END;

-- M-13: launchpad_campaigns (non-negative target_fiat_cents, ACL-compliant expiry bounds)
CREATE TRIGGER IF NOT EXISTS trg_launchpad_campaigns_bi
BEFORE INSERT ON launchpad_campaigns
WHEN NEW.target_fiat_cents < 0
  OR (NEW.voucher_expiry_months IS NOT NULL AND (NEW.voucher_expiry_months < 36 OR NEW.voucher_expiry_months > 120))
BEGIN
  SELECT RAISE(ABORT, 'launchpad_campaigns requires target_fiat_cents >= 0 and voucher_expiry_months in 36..120 when set');
END;

CREATE TRIGGER IF NOT EXISTS trg_launchpad_campaigns_bu
BEFORE UPDATE ON launchpad_campaigns
WHEN NEW.target_fiat_cents < 0
  OR (NEW.voucher_expiry_months IS NOT NULL AND (NEW.voucher_expiry_months < 36 OR NEW.voucher_expiry_months > 120))
BEGIN
  SELECT RAISE(ABORT, 'launchpad_campaigns requires target_fiat_cents >= 0 and voucher_expiry_months in 36..120 when set');
END;

-- M-13: launchpad_milestones (non-negative milestone_index, payout_percentage 1..100)
CREATE TRIGGER IF NOT EXISTS trg_launchpad_milestones_bi
BEFORE INSERT ON launchpad_milestones
WHEN NEW.milestone_index < 0 OR NEW.payout_percentage <= 0 OR NEW.payout_percentage > 100
BEGIN
  SELECT RAISE(ABORT, 'launchpad_milestones requires milestone_index >= 0 and payout_percentage in 1..100');
END;

CREATE TRIGGER IF NOT EXISTS trg_launchpad_milestones_bu
BEFORE UPDATE ON launchpad_milestones
WHEN NEW.milestone_index < 0 OR NEW.payout_percentage <= 0 OR NEW.payout_percentage > 100
BEGIN
  SELECT RAISE(ABORT, 'launchpad_milestones requires milestone_index >= 0 and payout_percentage in 1..100');
END;

-- M-13: launchpad_vouchers (bounded voucher status)
CREATE TRIGGER IF NOT EXISTS trg_launchpad_vouchers_bi
BEFORE INSERT ON launchpad_vouchers
WHEN NEW.status NOT IN ('issued', 'redeemed', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'launchpad_vouchers.status must be issued, redeemed, or cancelled');
END;

CREATE TRIGGER IF NOT EXISTS trg_launchpad_vouchers_bu
BEFORE UPDATE ON launchpad_vouchers
WHEN NEW.status NOT IN ('issued', 'redeemed', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'launchpad_vouchers.status must be issued, redeemed, or cancelled');
END;

-- M-13: launchpad_subscriptions (bounded channel)
CREATE TRIGGER IF NOT EXISTS trg_launchpad_subscriptions_bi
BEFORE INSERT ON launchpad_subscriptions
WHEN NEW.channel NOT IN ('email', 'telegram', 'webhook')
BEGIN
  SELECT RAISE(ABORT, 'launchpad_subscriptions.channel must be email, telegram, or webhook');
END;

CREATE TRIGGER IF NOT EXISTS trg_launchpad_subscriptions_bu
BEFORE UPDATE ON launchpad_subscriptions
WHEN NEW.channel NOT IN ('email', 'telegram', 'webhook')
BEGIN
  SELECT RAISE(ABORT, 'launchpad_subscriptions.channel must be email, telegram, or webhook');
END;

-- M-13: launchpad_snapshots (non-negative current_milestone, last_notified_milestone >= -1)
CREATE TRIGGER IF NOT EXISTS trg_launchpad_snapshots_bi
BEFORE INSERT ON launchpad_snapshots
WHEN NEW.current_milestone < 0 OR NEW.last_notified_milestone < -1
BEGIN
  SELECT RAISE(ABORT, 'launchpad_snapshots requires current_milestone >= 0 and last_notified_milestone >= -1');
END;

CREATE TRIGGER IF NOT EXISTS trg_launchpad_snapshots_bu
BEFORE UPDATE ON launchpad_snapshots
WHEN NEW.current_milestone < 0 OR NEW.last_notified_milestone < -1
BEGIN
  SELECT RAISE(ABORT, 'launchpad_snapshots requires current_milestone >= 0 and last_notified_milestone >= -1');
END;
