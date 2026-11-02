# Cohort 01: Commercial Credibility & 14-Day Payer Retention Ledger (CC5)

> **Authority**: `docs/plans/commercial-credibility-100x-ship.md` (Section CC5) and `docs/launch-checklist.md` (Step 11).
> **Honesty Invariant**: Never invent customer quotes, domains, or metrics. Only record verified paying accounts (`stripe_credited_sessions`) and measured 14-day retention outcomes.

## Live Funnel & Cohort Verification Command

Query the live D1 funnel and Stripe payer cohort summary at any time:

```bash
curl -sS -H "x-admin-secret: $ADMIN_SECRET" \
  "https://luminarasuite.com/api/admin/analytics/funnel?days=30"
```

Tracked stages in `product_analytics_events` (linked across anonymous-to-signed-in sessions via `luminara_guest_id`):
1. `probe_completed`
2. `signup_completed`
3. `instant_audit_completed`
4. `paywall_viewed`
5. `checkout_started`
6. `payment_completed` (emitted both by Stripe webhook and confirmed client return)
7. `fix_shipped`
8. `mission_completed`
9. `plan_expiring` / `plan_expired`
10. `survey_answered`

---

## First 10 Paying Customers Ledger

| # | Account ID (hashed/prefix) | Plan (`starter`/`growth`/`agency`) | Credited Date (UTC) | Baseline Probe / Audit Score | 1st Fix Shipped (`fix_shipped`) | 14-Day Re-Audit Score | Week-2 Active (`streakWeeks >= 2`) | PMF Survey (`survey_answered`) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 01 | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` |
| 02 | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` |
| 03 | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` |
| 04 | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` |
| 05 | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` |
| 06 | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` |
| 07 | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` |
| 08 | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` |
| 09 | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` |
| 10 | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` | `not_measured` |

---

## Verified Case-Study Snapshots (Before -> Fix Shipped -> After)

### Case Study 01 (Pending First Verified Cohort Completion)
- **Domain / Segment**: `not_measured`
- **Initial Finding (`finding_id`)**: `not_measured`
- **Action Shipped**: `not_measured`
- **Measured Delta (14-Day Re-Audit)**: `not_measured`
- **Shareable Receipt URL**: `not_measured`
