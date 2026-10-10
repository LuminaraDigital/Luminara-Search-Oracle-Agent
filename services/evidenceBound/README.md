# evidenceBound

Additive claim-integrity layer for Oracle, MCP, and browse.

## Invariants

1. Code owns `measured` / `estimated` / `not_measured` / `unknown`.
2. Models may only choose among closed option sets or observed ids.
3. `measured` claims require sources. Invalid Choice/Score/Noul JSON never unlocks an act.
4. Advisory confidence never alone unlocks paid tools or mutating browse acts.
5. No TypeSafe / Jev runtime dependency. Pattern library only.
6. Composite judgments are `estimated` or `not_measured`, never a Live invented SEO score.

## Layout

| File | Job |
|------|-----|
| `validate.ts` | Strict Choice / Score / Noul validation |
| `filterState.ts` | Minimal state for decisions |
| `claimLedger.ts` | Append-only claims + summaries |
| `intentRoute.ts` | Speculative fan-out router + self-consistency |
| `citationSupport.ts` | Evidence support gate |
| `atomicChecks.ts` | Per-dimension gut-checks |
| `compositeScore.ts` | Weights in code |
| `preParse.ts` | Regex candidates → choose by id |

See `docs/plans/evidence-bound-decision-100x.md` and `specs/0019-evidence-bound-decisions.md`.
