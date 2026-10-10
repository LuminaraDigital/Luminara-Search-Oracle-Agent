# Evidence-bound operator metrics

Internal notes for Wave E6. Not marketing copy.

## Counters to watch (logs / KV / future dashboard)

| Field | Meaning |
|-------|---------|
| `escape_rate` | Hallucination suite escapes; must stay **0** on CI (`tests/evidenceBound/hallucinationSuite.test.ts`) |
| `clarify_rate` | Intent router chose `clarify` (context missing or self-consistency fail) |
| `verified_claim_rate` | Share of ledger claims with status `measured` |
| `browse_goal_unverified` | `browse_goal` finished with `measurementStatus: not_measured` |
| `context_required_blocks` | MCP `CONTEXT_REQUIRED` on paid tools |
| `router_intent_histogram` | Counts per intent: scrape_enough, use_research_log, browse_interactive, paid_research, clarify |

## Production gates before deploy

1. `npm test -- tests/evidenceBound` green (0 escapes).
2. `npm run typecheck` and `npm test` green for browserAction + evidenceBound.
3. No TypeSafe / Jev runtime dependency in `package.json`.
4. Explicit operator approval (same as APS / Level 4).

## Rollback

Feature is additive under `services/evidenceBound/` plus stricter `browse_goal` checks. Rollback: revert the PR; Instant Audit scrape and paid DFS paths remain. Stricter `VERIFIER_CHECKS_REQUIRED` may break callers that omitted `checks`; update skills/clients to pass checks (honesty-required).
