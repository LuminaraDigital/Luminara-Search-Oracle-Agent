# Spec 0014: Budget Policies and Enforcement (Implementation)

Implements `docs/plans/budget-policies-and-enforcement.md` (spec 0013). Read that design record FIRST; it is the source of truth for decisions, table shapes, and phases. If any line in this spec conflicts with the doc, follow the doc and report the conflict.

## Objective
Ship Phase P0+P1 of the budget model: account-level monthly (UTC, recurring) billed-cents budget with soft alerts and hard stops enforced at the MCP governance gate, cost event ingestion, budget incidents, and approval/resume via the existing action-request pattern. Project-lifetime budgets (P2) are schema-included but not enforced; document that.

## Requirements

1. Migration `migrations/0012_budget_policies.sql`: create the tables exactly as sketched in the design doc (`budget_policies`, `cost_events`, `budget_incidents`); adapt column names to doc. Follow existing migration style (read 0011_mcp_action_requests.sql).

2. `worker/budgets.ts`:
   - `getBudgetPolicy(env, accountId)`, `upsertBudgetPolicy(env, {...})` (monthly billed_cents only for now; validate `monthly_budget_cents > 0`, `currency` default 'usd').
   - `recordCostEvent(env, { accountId, toolName?, runId?, billedCents, projectId? })`: insert cost event AND increment the account's current-window aggregate (choose: compute window sum via SQL SUM over cost_events for the current UTC month; simplest correct approach, no separate counter table unless doc says otherwise).
   - `getBudgetStatus(env, accountId)`: `{ policy, spentCents (current UTC window), percent, state: 'ok'|'soft_50'|'soft_80'|'soft_95'|'hard_stop', openIncident? }`.
   - `recordBudgetIncident(env, accountId, threshold, spentCents)`: dedupe per (account, window, threshold) so a threshold alerts once per window (UNIQUE constraint + INSERT OR IGNORE pattern).
   - `isBudgetHalted(env, accountId)`: true when hard stop active (spent >= monthly budget) and no approve-once override row exists for the current window. Approve-once override: reuse `mcp_action_requests` per the design doc (read the doc's approval/resume section; use `kind` column if the doc adds one, else a dedicated tool name convention it specifies; a migration alter is NOT allowed on 0011, so if a column is needed add it via `migrations/0013_mcp_action_requests_kind.sql` and update `mcpGovernance.ts` queries accordingly).
   - `approveBudgetResume(env, accountId, adminId)`: creates the override row for the current window.

3. Cost ingestion point: in `worker/mcpServer.ts` `callTool` after successful PAID tool execution (`executePaidTool` path), derive billed cents. Read `services/tools/registry.ts` + `types.ts` for what cost info exists at runtime; if real provider cost is unavailable, record the tool's declared credit cost as cents per the doc's interim rule and mark the cost event row `source: 'credit_class'` (add that column if doc lacks it). Free tools record nothing.

4. Enforcement gate: in `worker/mcpServer.ts` `callTool`, immediately BEFORE the existing `decideToolCall` call, check `isBudgetHalted`. If halted: record the block via the existing audit path with action `mcp_tool_block` + reason `budget_exhausted`, runProvenance completion status `budget_halted` where a run exists, and return the governance-style block result `{ code: 'BUDGET_EXHAUSTED' }` with the same message shape as GOVERNANCE_BLOCKED. Interaction: budget gate runs before governance; budget block wins.
   - Soft alerts: after `recordCostEvent`, check status; on crossing 50/80/95 record an incident (deduped) and audit-log action `budget_soft_alert` (redacted details). Never block on soft.

5. HTTP routes in `worker/index.ts` (read existing route style first; auth via existing firebase/hosted identity middleware):
   - `GET /api/budgets/self` -> budget status for the caller's account.
   - `PUT /api/budgets/self` { monthlyBudgetCents } -> upsert.
   - `POST /api/budgets/self/resume` -> approve-budget-resume for current window (self-service for the account owner; document the authz choice).

6. Tests `tests/budgetPolicies.test.ts` (>= 18 cases) using `tests/helpers/sqliteD1.ts` (read it first; it runs the REAL migrations, which validates 0012 SQL syntax against sqlite): policy CRUD validation, window math across month boundary (inject clock via param where possible; if functions use Date.now, allow passing `now` into status/record functions), soft threshold crossing + incident dedupe, hard stop halt + resume override, resume only applies to current window, cost event accumulation, MCP gate integration (budget block wins over governance allow; budget_exhausted audit row written), route smoke tests with mocked auth. Full-suite safety: do not break existing MCP/aps tests.

## Edge cases
- No policy row for account: unbudgeted, never halted, status state 'ok' with policy null.
- Zero/negative budget rejected with 400 via route, thrown error via service.
- Concurrent recordCostEvent calls under Promise.all must not double-count (sqliteD1 batch/transaction semantics; the helper exists for this, use Promise.all in a test to prove it).
- Clock skew: window computed from a single `now` passed through, never Date.now() called twice in one function.

## Constraints
- Luminara branding, no vendor names, no em dashes anywhere.
- No changes to redemption/payment/TON semantics; do not touch paymentLedger.ts except reading it.
- `scratch/wip-mcp/` is dead history; do not reference it. All spec 0009/0010 work is landed at worker/ and specs/ now.
- No git commits.

## Definition of done
- `npm run typecheck` green.
- `npx vitest run tests/budgetPolicies.test.ts tests/mcpGovernance.test.ts tests/apsMcp.test.ts tests/browserActionMcp.test.ts tests/paymentLedger.test.ts tests/planEntitlements.worker.test.ts` green.
- `node -e` smoke: apply migrations to an in-memory sqlite via the test helper indirectly is enough (vitest covers it); plus `npm run secrets:check` and `node scripts/check-forbidden-tokens.mjs --all` stay green.

## Iteration budget: 3 build-review loops.
