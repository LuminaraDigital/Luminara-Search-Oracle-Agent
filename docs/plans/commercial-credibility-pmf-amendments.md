# Commercial credibility: PMF study amendments

**Date:** 2026-10-10  
**Status:** DRAFT, unreviewed. One session's reading of the tree at `9da5f59`. No specialist audit, CEO gate or citation verifier has run (see section 6). Nothing here changes a lock in the parent plan until the owner answers section 5.  
**Parent plan:** [`commercial-credibility-100x-ship.md`](./commercial-credibility-100x-ship.md) (CC0-CC5). This file adds to it. It is a separate file because a peer session was editing the parent while this was written; fold it in with a docs-only PR once the parent settles.  
**Source:** `pmf-repo-study-2026-10-10.md`, an external read of `main` at `42880f5`. Every claim was checked against the working tree before use. The study was wrong or stale on several points (section 2).

## 1. Where the study's ten gaps land

| # | Study gap | Disposition |
|---|-----------|-------------|
| 1 | Provider reliability, Workers AI fallback | Parent CC1. Looks largely landed (section 2). A Workers AI fallback is allowed only under CC1 task 6: it must surface `HOSTED_PROVIDER_DEPLETED` and never mint a Measured score. |
| 2 | Replace rubric scores | Estimated label landed (`3317d4b`). "N of M checks" display and the share-of-voice floor are new: CC1 tasks 10-12 below. |
| 3 | Stripe card checkout | Parent CC2. The study says Stripe is absent; it is not (section 2). No change. |
| 4 | USDT price drift | New. Owner decision 5-A. |
| 5 | Count audits, fair-use cap | New. Phase CC6 below. |
| 6 | Standalone Fix list | Parent CC4 owns the embedded list. A standalone view stays deferred; optional CC4 task 9 below. |
| 7 | Check / Fix / Progress nav | Parent CC3. The study's shape differs from the CC3 nouns. Owner decision 5-C. |
| 8 | Scheduled Telegram nudges | Parent CC4 task 7 (optional). Concrete shape below. |
| 9 | Tracking for the five PMF numbers | Parent CC5 task 1. One live bug first (section 3.3), then the missing events. |
| 10 | Renewals, then agent pay-per-audit | Renewals: CC2 task 12 below. q402 pay-per-audit: deferred, section 4. |

## 2. Corrections to the study, and to the parent plan's status

1. **Stripe exists.** `worker/stripePayment.ts` is in the tree, and `c593cc9` added the rank guard, guest id sanitization and the refund webhook. What remains is operational (secrets, migration 0021, staging smoke) plus the "/ mo" versus "30 days" copy gate in CC2 task 9.
2. **The 85-minus-penalty health score is already labelled estimated** (`playbookAuditorAgent.ts`, the "(estimated)" completion message, `3317d4b`).
3. **CC1 looks further along than the parent says.** By grep at `9da5f59`: no hardcoded 74 in `services/decision/fastDecisionService.ts`, no `schemaSafetyDefault` in `services/geminiService.ts`, and `HOSTED_PROVIDER_DEPLETED` exists in `worker/providerRelay.ts`. Acceptance tests were not re-run here.
4. **The parent's status line overclaims.** It now reads "CC0-CC4 code complete and verified in tree", but 35 of its 40 acceptance checkboxes are unticked and its section 8 says a phase is not done until the double-check passes. The line arrived in `f18018e`, a commit titled as a landing fix. Whoever owns that edit should reconcile it.
5. **Streak cadence.** The server progression is weekly (`streak_weeks` in `worker/referrals.ts`), while CC4 wants a daily check-in count. They coexist: the weekly missions (rescout, view delta, ship one fix) are the loop, and the daily check-in is a light habit that must not trigger a provider call. CC4 must not add a daily audit.
6. **Anonymous analytics are not dropped by the Worker.** `ingestProductAnalytics` stores events with a null `account_id`. The real gap is that the client `sessionId` is `String(this.sessionStartTime)` (`services/analytics/productTelemetry.ts`, `flushToServer`), a page-load timestamp, so a Probe visit cannot be linked to the later signup.

## 3. Net-new work

### 3.1 CC1 additions (honesty residual)

- **Task 10, share-of-voice floor.** `services/agentCore/agents/serpRadarAgent.ts` computes `citationRatePercent * 0.85 + (totalItems > 5 ? 15 : 5)`, so a site never cited in live rows still shows 5 or 15. Drop the floor or label the figure estimated, and show the sample beside every citation percent ("2 of 3 results").
- **Task 11, checks passed.** Show "N of M checks passed" as the primary figure and keep the 0-100 number only as a secondary estimated label. M is the count of checks the auditor actually evaluated; do not invent a denominator.
- **Task 12, demo claim.** `services/notebook/demoNotebook.ts` hardcodes "wins 73% more AI Overviews citations" (twice). Remove it or mark it illustrative while Studio stays reachable. This is the same kind of invented proof CC5 forbids.

Acceptance: a site with zero live mentions never shows a nonzero share of voice; no citation percent appears without its sample size; `rg "73% more"` returns nothing outside tests that assert its absence.

### 3.2 CC6, metering and fair use (new phase, after CC2)

Not a blocker for the first payers. Required before "unlimited" is marketed at scale, because provider cost is real.

Facts at `9da5f59`:

- `checkHostedQuota` (`worker/quotaMiddleware.ts`) counts hosted requests per UTC day against `FREE_DAILY_LIMIT` (25 in production, `wrangler.jsonc`). It runs once per relay call (`worker/providerRelay.ts`) and again from Oracle, Idea Scout and PageSpeed. One audit makes several calls, so the UI's "25/25 used" is a count of calls, not audits (`components/audit/InstantAuditView.tsx`, `components/paywall/UsageQuotaBadge.tsx`).
- Any active subscription is unlimited. Starter's copy says "Unlimited AI audits for up to 2 sites".
- `/audit/run` is a queue route that is off unless `AUDIT_QUEUE_ENABLED` is set (`worker/index.ts`), so on the main path the Worker never sees an audit boundary.

Tasks:

1. Choose the audit unit and where it is counted. Either the client announces a run start and the Worker meters once and issues a run id (relay calls under that id draw on it up to a ceiling), or audits move onto the queue route. This is a design decision, not a given.
2. Keep the per-call relay guard as an abuse backstop with a higher ceiling.
3. One message source for `InstantAuditView`, `UsageQuotaBadge`, `NotebookView` and the Telegram bot. The unit named in the message is the unit being counted.
4. A fair-use cap for paid plans, with `services/plans/planEntitlements.ts` and the Starter/Growth copy changed to match. No "unlimited" with a hidden cap.
5. Tests for metering, the backstop, and message parity.

Numbers (free allowance, paid cap) are an owner decision (5-B). The study's "3 a week" is an example, not a recommendation.

Kill: copy that says unlimited with a hidden cap; a limit message in a unit the user cannot see.

### 3.3 CC5 additions (instrumentation)

**Live bug first.** The client union `TelemetryEventType` (`services/analytics/productTelemetry.ts`) now includes `probe_completed`, `signup_completed`, `paywall_viewed` and `payment_completed`. The Worker's `ALLOWED_TYPES` (`worker/productAnalytics.ts`) has none of them, and `ingestProductAnalytics` skips any unlisted type. So those events are emitted and silently discarded. Add them to the allow-list, with a test that every client event type is either allow-listed or listed as client-only.

**Naming bug.** `components/paywall/PaywallModal.tsx` fires `payment_completed` with `status: 'initiated'` when checkout starts. A name that says "completed" for an initiated checkout will overcount payers. Rename it `checkout_started` and write `payment_completed` only from the Worker at the payment claim (Stripe webhook, Stars, TON), where it is true.

**Still missing:** `checkout_started{rail}`, server-side `payment_completed{plan,rail}`, `fix_shipped`, `mission_completed{mission}`, `plan_expired`, and a `survey_answered` Sean Ellis question after week two. Use the existing `paywall_viewed`, not the study's `paywall_shown`. Add a durable guest id to replace the timestamp `sessionId` so Probe, signup and payment link. Add a weekly cohort query (signed-in accounts with a `session_started` in week N+1) as a SQL view or admin page.

### 3.4 CC2 additions

- **Task 12, renewals.** Plans are one-shot 30-day grants (`days: 30` in the `PLANS` table of `worker/telegramBot.ts`, `expiresAt` set from it). There is no expiry event or reminder. Add `plan_expiring` and `plan_expired`, and an opt-in reminder using the delivery from CC4 task 7. If CC2 task 9 chooses Stripe Subscriptions, renewal is Stripe's job and this covers Stars and TON only.
- **Task 13, USDT guard.** `tests/pricingDiscoverability.test.ts` locks Stars and TON to the checkout catalogs and has no Jetton assertion. After decision 5-A, add one.

### 3.5 CC3 addition

The study proposes four doors: Check (Instant Audit; Idea Scout as the no-website entry), Fix (Fix list, Ask, Business Profile), Progress (Brand Memory, Sentinel, missions, streak), Profile (Trust), with Studio, Tools, Labs, Launchpad, Hub, MCP/API and desktop in an Advanced drawer. CC3 section 3 lists Instant Audit, Ask, Fix list, Re-check and Pricing. The study folds Ask under Fix and adds Progress. Resolve this before CC3 starts (decision 5-C). The study's nav claims about `OmnibarModal` were not verified here.

### 3.6 CC4 additions

- **Task 9 (optional), mark shipped.** The data exists: `weekly_decisions.verify_by` (migration 0014) and `shipCommitmentService`. Marking a finding shipped should update its status through `findingBoardService` and set a re-check date from `verify_by`. No UI exists. A flat standalone Fix view is allowed by CC4 task 8 (only the kanban is excluded) but is not needed until the embedded list shows return visits.
- **Task 7 detail, scheduled nudges.** `worker/scheduledJobs.ts` has one cron (`DAILY_CRON`, 08:00 UTC) mapped to three jobs. Add a `mission_nudge` job name to `ScheduledJobName`, `ALL_SCHEDULED_JOBS` and `CRON_JOBS`. A weekly nudge can ride the daily cron with a weekday check, so `wrangler.jsonc` needs no new cron. `formatWeeklyMissionNudge` (`services/referrals/rules.ts`) exists and is today used only by the `/missions` command in `worker/telegramBot.ts`. Telegram only, opt-in, under decision 20 consent.

## 4. Deferred

- **q402 pay-per-audit for agents.** `isQ402SettlementLive` (`worker/q402/facilitator.ts`) is an env switch (`Q402_LIVE`, default off), not a code edit, and the "not live" error is intended. The settlement path was not tested here. Defer until after the first 10 payers and a testnet proof, consistent with the parent's "Jetton checkout as primary web rail" deferral.
- **Standalone Fix view and nav rebuild** beyond CC3 and CC4 as written.

## 5. Owner decisions needed

| # | Decision | Recommendation |
|---|----------|----------------|
| A | USDT ladder. `JETTON_PRICING` in `worker/tonPayment.ts` is 29 / 79 / 199 against US$49 / 149 / 349 on the card ladder: 41%, 47% and 43% lower. `JETTON_CHECKOUT_LIVE` is true. Align the ladder, or keep it as a deliberate crypto discount and document it. | Decide, then add the CC2 task 13 guard either way. Not mine to pick: it is a pricing call. |
| B | Metering numbers: free audits per period, paid fair-use cap, and the audit unit (3.2 task 1). | Pick numbers from measured provider cost per audit, not from the study's example. |
| C | Nav shape: the study's four doors versus the CC3 nouns. | Keep the CC3 nouns for the fold; treat Progress as a signed-in nav group. |
| D | Streak decision 9. The owner brief row 9 is still open and only recommends option B, while the parent calls it locked. `components/retention/DailyStreakCard.tsx` still prints "Target: 4-week Operator status (+200 Lumens)", which breaks CC4's count-only acceptance. | Answer decision 9. Until then the Lumens line contradicts the plan. |

## 6. Review record

Round 0: author draft from one session. File and symbol references were read by the author at `9da5f59`. Not verified: the Omnibar groups, whether the client sends analytics without a token, the q402 verify and settle path, the claim that every CC1 task is complete, and the production state of any of it.

Pending per the plan review loop: backend, AI and frontend audits; a CEO gate; a citation and SQL verifier. Status stays DRAFT until all three return go.
