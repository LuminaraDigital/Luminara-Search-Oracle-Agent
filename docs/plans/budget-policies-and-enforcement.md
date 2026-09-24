# Budget Policies and Enforcement

Status: design record (spec 0013). Documentation only; no code in this loop.
Audience: the future implementation loop that wires budget enforcement into the
existing quota, payments, and MCP surfaces.

## Context

Luminara already has three adjacent control systems, none of which is a budget
system. This section maps what exists today so the budget model lands on real
seams instead of inventing parallel ones.

### 1. Daily hosted quota (usage visibility)

`worker/quotaMiddleware.ts` meters hosted AI usage:

- `checkHostedQuota(env, user, opts)` returns a `QuotaStatus` and is the gate
  used by `worker/providerRelay.ts` and `worker/pagespeedRoute.ts`.
- `meterDailyQuota` counters live in KV as `quota:<quotaKeyId>:<YYYY-MM-DD>`
  with a 2-day TTL; the window is a UTC calendar day (midnight-UTC reset
  computed in `checkHostedQuota`).
- `FREE_DAILY_LIMIT` is the only limit knob; anonymous users are metered by IP
  (`anon:<ip>`) when `REQUIRE_TG_AUTH` is off.
- `getActiveSubscription` / `isUserSubscribed` read `sub:<accountId>` (plus
  legacy `sub:<loginId>`) from `LUMINARA_KV`; an active subscription makes the
  quota `isUnlimited`. When KV is unbound the middleware fails closed.

This is a request-count quota for free-tier hosted keys. It says nothing about
money, paid MCP tools, or per-project spend.

### 2. Plan entitlements and credit classes (access, not budgets)

- `worker/telegramBot.ts` defines `PLANS` (`starter`, `growth`, `agency`,
  `single_audit`, `multi_agent_crawl`) and `planCapsFor(planId)`, which
  resolves caps: `domainLimit`, `sentinelLimit`, `agencyClientLimit`,
  `scheduledReaudit`, `apiAccess`, `shareLinks`, `mcpAccess`.
  `FREE_PLAN_CAPS` covers the unsubscribed state.
- `specs/0004-mcp-entitlements-and-credits.md` fixes three credit classes:
  Free MCP (Growth+), Paid research (Agency `apiAccess` or BYOK DataForSEO),
  and Agency API. It explicitly deferred a credit ledger ("reuse quota
  middleware").
- `services/tools/types.ts` types this as `McpCreditClass = 'free' | 'paid'`;
  `services/tools/paidCatalogue.ts` marks every paid research tool
  `creditClass: 'paid'`.
- `worker/mcpServer.ts` enforces access: `buildCtx` composes
  `getActiveSubscription` + `planCapsFor`; `canUsePaid(ctx)` is true for
  Agency (`caps.apiAccess`) or a BYOK `x-provider-key`; `callTool` rejects a
  paid tool without it, returning `PAID_TOOL_FORBIDDEN`.

Entitlements answer "may this account call this tool at all". They do not
answer "how much has this account or project spent this month, and should we
stop".

### 3. Payment ledger (money in, atomic claiming)

- `migrations/0004_payment_atomicity.sql` creates the D1 claim tables:
  `license_key_claims`, `license_redemptions`, `license_trial_claims`,
  `ton_credited_tx`, `stars_credited_charges`.
- `worker/paymentLedger.ts` implements claim-before-grant
  (`claimLicenseRedemption`, `claimTonTransaction`, `claimStarsCharge`)
  running as single D1 batches, and fails closed when `DB` is unbound or the
  tables are missing (`LEDGER_MIGRATION` pointer, `reportLedgerFault`).
  Release helpers (`releaseLicenseRedemption`, `releaseTonTransaction`,
  `releaseStarsCharge`) undo a claim when the grant step fails after claiming.
- `worker/tonPayment.ts` (`createTonInvoice`, `verifyTonPayment`,
  `findMatchingTonPayment`) settles TON on-chain and credits a plan via
  `writeSubscriptionRecord`; every credit is audit-logged with
  `recordAuditLogBestEffort` (action `ton.credit`).

This direction of flow is money arriving. Budget enforcement is the inverse:
money (or metered cost) leaving, observed and stopped.

### 4. Governance gate (spec 0010 work in progress)

`worker/mcpGovernance.ts` implements the spec-0010 governance layer:
`TOOL_GOVERNANCE` risk-classifies every MCP tool (`read` / `write` /
`destructive`, `active` / `quarantined`), and `decideToolCall(toolName, ctx,
approved)` returns `allow`, `block` (e.g. `tool_quarantined`,
`subscription_required`), or `require_approval`
(`destructive_requires_approval`). Destructive calls create rows in
`mcp_action_requests` via `createActionRequest`, resolved with
`approveActionRequest` / `denyActionRequest` and consulted by
`hasApprovedRequest`. The module is landed at `worker/mcpGovernance.ts`,
wired into `worker/mcpServer.ts`, and covered by `tests/mcpGovernance.test.ts`;
`migrations/0011_mcp_action_requests.sql` holds the table.

### 5. Run audit trail

`worker/runProvenance.ts` already models run lifecycle and its `RunStatus`
union includes `budget_halted`. The audit path (`startRun`, `completeRun`,
`worker/auditLog.ts` `recordAuditLog` with hashed chain via
`computeAuditHash`) is where budget blocks must land, so a budget stop is
indistinguishable in evidence quality from any other governed decision.

### What is missing

- No persisted spend observation: paid tool calls hit DataForSEO or OpenRouter
  through `services/tools/registry.ts` (`executePaidTool`,
  `buildPaidToolRuntime`) with no cost event recorded.
- No budgets at any scope: neither accounts nor projects have a spend limit,
  a soft warning, or a hard stop.
- No incident/approval flow for money; `mcp_action_requests` covers
  destructive-tool approval only.
- The plan caps in `planCapsFor` are entitlements, not budget counters.

## Product decisions

Each decision carries a one-line rationale.

1. Enforceable metric is billed cents, not tokens: DataForSEO, OpenRouter,
   PageSpeed, and future billers count differently, and money is the only
   unit that normalizes across providers.
2. Account budgets recur monthly on UTC calendar months: matches how
   `checkHostedQuota` already computes UTC day boundaries and how operators
   think about bills.
3. Project budgets are lifetime totals that never auto-reset: a project is a
   bounded workstream, and silent resets defeat the point of a cap.
4. Soft alerts at 50 / 80 / 95 percent, hard stop at 100: three escalating
   warnings catch both fast and slow burn; 100 is the only unambiguous hard
   line.
5. Budgets are policy; the existing quota counters remain usage visibility:
   `quotaMiddleware` keeps answering "how much free hosted usage is left
   today" while budgets answer "should spend stop".
6. Budget exhaustion is a new `block` reason in `decideToolCall`, not a
   parallel gate: one decision function, one audit path, one operator mental
   model.
7. Hard stops create an approval in `mcp_action_requests` rather than a new
   table: the spec-0010 approval flow already has create, dedupe, expiry,
   and decision semantics we would otherwise re-implement.
8. Spend is recorded as `cost_events` rows appended by the tool runtime
   after successful paid calls: the observation point sits next to the money
   action, not in a poll loop.
9. BYOK calls (`dataForSeoCredential` set) record zero billed cents: the
   account supplied its own key, so Luminara owes nothing, though usage
   stays visible.
10. Budget state is fail-closed on the enforcement path but fail-open on the
    alerting path, mirroring `paymentLedger`: never silently allow what you
    cannot meter; never block work because an alert could not be sent.
11. `budget_halted` (already in `RunStatus`) is the terminal status for runs
    stopped by budget hard stops: the audit trail reuses provenance, no new
    vocabulary.

## Budget model

### Scopes

- `account`: monthly recurring budget, `window_kind = 'calendar_month_utc'`.
  Resolves through the existing account identity (`billingId(user)` in
  `worker/mcpServer.ts`, `resolveAccountId` in `worker/userStore.ts`).
- `project`: lifetime budget, `window_kind = 'lifetime'`; `scope_id` is the
  `projects.id` from `migrations/0006_agent_mcp_product_surface.sql`.

The account scope is the backstop; the project scope is the precision
instrument. A call is checked against every applicable policy: the account
policy always, and the project policy when the tool call carries a
`projectId` (paid research tools require it in `paidCatalogue.ts`).

### Metric and window

- `metric`: starts with `billed_cents` only. Advisory metrics
  (`requests`, `tool_calls`) may be added later as soft-only policies.
- `window_kind`: `calendar_month_utc` (reset at 00:00 UTC on the first of
  the month) or `lifetime` (no reset; manual raise only).

### Policy shape

A budget policy is: scope, metric, window, amount, warn thresholds
(default 50/80/95), `hard_stop_enabled`, `is_active`. Policies are
configuration, editable without code. Observed amounts are computed from
`cost_events`, not stored as mutable counters, so a replay or correction
recompute is always possible.

## Enforcement flow

### Where the gate sits

Two enforcement points, both inside existing call paths:

1. Preflight: `worker/mcpServer.ts` `callTool`, immediately after the
   existing paid-tool entitlement check (`creditClass === 'paid' &&
   !canUsePaid(ctx)`), calls the budget check before dispatching to
   `executePaidTool` in `services/tools/registry.ts`.
2. Decision: inside the spec-0010 gate. `decideToolCall(toolName, ctx,
   approved)` gains a budget-exhausted input (surfaced in `PolicyContext`
   or a sibling argument) and returns
   `{ action: 'block', reason: 'budget_exhausted' }`. The decision then
   flows through the same `runProvenance` / `auditLog` recording as
   `subscription_required` does today, including `redactSensitive` on
   payloads.

The hosted-quota middleware (`checkHostedQuota`) is untouched: it meters
free-tier hosted AI requests per UTC day and stays purely a usage-visibility
counter (decision 5). Paid MCP tools do not pass through it.

Soft alerts are evaluated post-call by the cost-event writer: appending a
`cost_events` row recomputes window totals and emits notifications at first
crossing of 50/80/95 in the current window. One alert per threshold per
window (dedupe by unique partial index on incidents).

### Hard stop semantics

- At 100 percent of the account monthly budget: all `creditClass: 'paid'`
  tool calls for the account block with `budget_exhausted` until the window
  resets or the budget is raised.
- At 100 percent of a project lifetime budget: paid tool calls carrying that
  `projectId` block; other projects on the account continue.
- The block returns a tool result with `isError: true` and a structured code
  (proposed `BUDGET_EXHAUSTED`), matching how `PAID_TOOL_FORBIDDEN` is
  returned from `callTool` today.
- Active runs: a run already in flight finishes its current tool call (the
  spend lands in `cost_events` and may overshoot slightly; that is recorded
  honestly), then the next preflight check blocks further paid calls.
  Provenance completes the run with status `budget_halted` when the caller
  unwinds because of a budget block.
- KV/subscription state is never touched: budget blocks do not downgrade
  entitlements.

## Approval and resume flow

Recommendation: reuse `mcp_action_requests` (defined in the spec-0010
governance module) instead of adding a new approval table.

Justification:

- It already has the right lifecycle: `pending | approved | denied`,
  `decided_by`, `decided_at`, `expires_at`
  (`APPROVAL_TTL_MS = 30 min` in the current module; budget approvals will
  want a longer TTL, see open questions).
- `createActionRequest` already dedupes one pending request per
  `(user_id, tool_name, project_id)`, which maps directly onto "one open
  budget approval per account/project".
- Operators get one inbox for destructive-tool and budget approvals instead
  of two.

Extension needed: `mcp_action_requests` gains a `kind` column (or an
`args_json` convention of `{ kind: 'budget_override', policyId, scopeType,
scopeId, observedCents, limitCents, windowStart, windowEnd }`, with
`tool_name = 'budget_override'`). Payload should include top cost drivers
(project ids, tool names) so the approver sees what burned the budget.

Resolution actions:

- Approve with raise: operator supplies a new `amount`; the policy update and
  the approval resolution commit in one D1 batch (same atomicity pattern as
  `paymentLedger`).
- Approve once (resume without policy change): approval authorizes continued
  spend for the current window only; a new hard-stop incident opens only on
  the next window or a further threshold.
- Deny / keep stopped: scope remains blocked; entitlement state unchanged.

Soft alerts never create approvals: they produce an audit log entry plus a
user-visible notification state only.

## Data model sketch (D1)

Migration numbering: this loop landed `migrations/0011_mcp_action_requests.sql`
(MCP governance, spec 0010), so the next free migration number is `0012_`.
Verify against `migrations/` at implementation time.

Proposed tables for `migrations/0012_budget_policies.sql`:

```sql
CREATE TABLE IF NOT EXISTS budget_policies (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('account', 'project')),
  scope_id TEXT,               -- projects.id for project scope; NULL for account
  metric TEXT NOT NULL DEFAULT 'billed_cents',
  window_kind TEXT NOT NULL CHECK (window_kind IN ('calendar_month_utc', 'lifetime')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  warn_percents TEXT NOT NULL DEFAULT '[50,80,95]',
  hard_stop_enabled INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_budget_policies_scope
  ON budget_policies(account_id, scope_type, scope_id);

CREATE TABLE IF NOT EXISTS cost_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT,
  tool_name TEXT NOT NULL,
  provider TEXT NOT NULL,          -- 'dataforseo' | 'openrouter' | 'pagespeed' | ...
  billed_cents INTEGER NOT NULL DEFAULT 0,  -- 0 for BYOK
  credit_class TEXT NOT NULL,      -- 'free' | 'paid' (McpCreditClass)
  run_id TEXT,                     -- provenance link when inside a run
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cost_events_account_window
  ON cost_events(account_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cost_events_project
  ON cost_events(project_id);

CREATE TABLE IF NOT EXISTS budget_incidents (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL REFERENCES budget_policies(id),
  account_id TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id TEXT,
  window_start INTEGER NOT NULL,   -- lifetime windows use policy created_at
  window_end INTEGER,              -- NULL for lifetime
  threshold_percent INTEGER NOT NULL,
  threshold_kind TEXT NOT NULL CHECK (threshold_kind IN ('soft', 'hard')),
  amount_limit_cents INTEGER NOT NULL,
  amount_observed_cents INTEGER NOT NULL,
  approval_request_id TEXT,        -- mcp_action_requests.id for hard stops
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
-- One open incident per policy, threshold, and window: no duplicate alerts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_incidents_open
  ON budget_incidents(policy_id, threshold_percent, window_start)
  WHERE status = 'open';
```

`mcp_action_requests` needs a `kind TEXT NOT NULL DEFAULT 'tool'` column (or
the `args_json` convention above); that ALTER rides in the same migration.

Compatibility: there are no legacy budget columns to migrate (unlike the
reference pattern); the only carry-over is that `planCapsFor` entitlements
stay the access layer underneath budgets.

## Rollout phases

- P0, soft alerts only: ship `budget_policies`, `cost_events`,
  `budget_incidents`, and the post-call threshold evaluation. No blocking.
  Validates cost attribution against real DataForSEO and OpenRouter invoices
  before anything can stop work.
- P1, hard stops for paid MCP tools: enable `hard_stop_enabled` on account
  monthly budgets; wire the preflight block into `callTool` and
  `decideToolCall`; hard stops create `mcp_action_requests` approvals.
  Requires the spec-0010 governance module to have landed under `worker/`.
- P2, project budgets: project lifetime policies, project pause semantics
  in the tool path, per-project budget cards in the UI, resume-once
  resolution. Optionally extend hard stops to other paid surfaces
  (`providerRelay`, scheduled Sentinel audits) once the MCP path proves out.

Each phase is independently shippable; P0 data makes P1 threshold defaults
defensible.

## Alternatives considered

- Token-based hard stops: rejected; providers tokenize differently, cached
  tokens muddy totals, and some future charges (crawls, attestation) are not
  token-shaped. Money is the common denominator. Tokens may return as
  advisory policies later.
- Extend `quotaMiddleware` with money counters: rejected; it is KV-based,
  request-count-shaped, and UTC-day-scoped. Budgets need D1 durability,
  month/lifetime windows, and atomic multi-step updates, matching the
  `paymentLedger` precedent, not the quota one.
- A separate `credit_ledger` for spend: rejected for now, consistent with
  spec 0004 ("defer; reuse quota middleware" evolved into "budgets are
  policy, credits stay entitlements"). `cost_events` gives observability
  without inventing a parallel currency.
- A dedicated budget approval table: rejected; `mcp_action_requests` already
  implements create, dedupe, decide, expire. One approval inbox beats two.
- Hard-blocking whole entitlements (flip plan caps off on exhaustion):
  rejected; entitlements are subscription truth, budgets are operator
  policy. Budget blocks must not rewrite subscription state in KV.
- Account-level daily or weekly windows: deferred; monthly UTC matches
  billing cadence. Extra windows are additive policies later, not a
  redesign.

## Open questions

- TTL for budget approvals: `APPROVAL_TTL_MS` is 30 minutes for destructive
  tool calls; a budget override probably wants 24-72 hours or no expiry
  until window end. Decide whether TTL becomes per-`kind`.
- Who may raise a budget: plan owner only, or any admin in the enterprise
  RBAC model from `migrations/0003_enterprise_orgs_rbac.sql`? The approval
  `decided_by` column supports either; the UI gate does not yet exist.
- DataForSEO cost attribution granularity: do we trust returned `cost`
  fields per call, or price per endpoint from a maintained rate card?
  P0 exists to answer this with real invoices.
- BYOK accounting: record zero-cents `cost_events` for visibility only, or
  also track notional cost so users can compare BYOK vs hosted spend?
- Should `checkHostedQuota`'s daily free requests ever count toward an
  account budget (hosted keys consume real provider spend)? Likely yes as a
  later metric class; out of scope for P0-P2.
- Resume-once semantics for lifetime project budgets: a resume without a
  policy change re-arms the same hard limit, so the next paid call blocks
  again. Is that acceptable, or must resume-once imply "raise by at least
  one cent"?
- Alert delivery channel for soft thresholds: audit log + dashboard state
  in P0, or also Telegram bot message via the `api` helper in
  `worker/telegramBot.ts` for accounts that linked Telegram?

## Implementation checklist for the future loop

- Landing order: migration, `cost_events` writer in
  `services/tools/registry.ts` runtime, policy CRUD, threshold evaluator,
  `decideToolCall` budget input, `callTool` preflight, approval payloads,
  UI surfaces.
- Every money-state change follows the `paymentLedger` pattern: claim /
  write inside one D1 batch, fail closed, release on post-commit failure.
- Every budget block and alert records through `recordAuditLog` and, when
  inside a run, `runProvenance` with `budget_halted`.
- Tests required: 50/80/95 single-fire alerting per window, hard stop at
  100 for account and project scopes, BYOK zero-cents events never
  triggering stops, one open incident per policy/threshold/window, approval
  raise-and-resume commits atomically, budget block appears in the audit
  chain, `quotaMiddleware` behavior unchanged.
