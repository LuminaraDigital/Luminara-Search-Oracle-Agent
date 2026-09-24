# Spec 0013: Budget Model Design Record (Documentation Only, No Code)

Source pattern: paperclip `doc/plans/2026-03-14-budget-policies-and-enforcement.md` + `server/src/services/budgets.ts` reasoning, adapted to Luminara. Brand: Luminara only.

## Objective
Produce a decision-ready design record `docs/plans/budget-policies-and-enforcement.md` mapping Luminara's existing quota/credit/payment surfaces onto a budget enforcement model, so a future implementation loop can execute without re-litigating design decisions.

## Method (required reading first)
1. paperclip sources at the cloned copy under the Hermes scratch dir (`$TMPDIR/paperclip`): read `doc/plans/2026-03-14-budget-policies-and-enforcement.md` in full and skim `server/src/services/budgets.ts` for enforcement mechanics. Extract portable reasoning only; write in Luminara terms.
2. Luminara sources in this repo: `worker/quotaMiddleware.ts`, `worker/paymentLedger.ts`, `worker/tonPayment.ts`, `worker/telegramBot.ts` (planCapsFor), `services/tools/registry.ts` (credit classes), `migrations/0004_payment_atomicity.sql`, and `specs/0004-mcp-entitlements-and-credits.md`.

## Document requirements
- Sections: Context (current state of quota/credits, with real file paths), Product decisions (each with one-line rationale), Budget model (scopes: account monthly recurring vs project lifetime; enforceable metric: billed cents vs credit classes; UTC windows), Enforcement flow (soft alert thresholds at 50/80/95, hard stop semantics, where the gate sits relative to the existing quotaMiddleware and the new spec-0010 governance gate; document interaction with `decideToolCall`: budget exhaustion is a `block` reason fed into the same audit path), Approval/resume flow (reuse `mcp_action_requests` vs new table: recommend and justify), Data model sketch (table names + columns, D1, migration numbering guess `0012_`), Rollout phases (P0 soft-alert only, P1 hard stops for paid MCP tools, P2 project budgets), Alternatives considered, Open questions.
- Hard constraints baked into decisions: hard stops in billed cents not tokens (cross-provider normalization argument), UTC calendar months, project budgets do not auto-reset, budgets are policy while existing quota counters remain usage visibility.
- Length: 250-450 lines. Must name real Luminara files, tables, and functions. No em dashes, no vendor names from the paperclip repo.

## Definition of done
- File exists, reads as a standalone design record someone could implement from.
- Factual claims about Luminara code verified against the actual files (spot-check with grep).
- No code changes made in this loop. `npm run typecheck` unaffected (run it to confirm).

## Iteration budget: 1 review pass. Verification: file written, greps re-run, typecheck green.
