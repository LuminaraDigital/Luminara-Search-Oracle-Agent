# Indexed DOM action measurement (fixture)

Offline harness only. Not a hosted SLA. Do not use these numbers in marketing without re-running on a live crawler.

## How to run

```bash
npx vitest run tests/browserActionMeasure.test.ts
```

## What it compares

| Path | Protocol-unit model (simulated CDP) |
| --- | --- |
| **Naive stub** | Per step: walk ~80 tree nodes × 2 CDP reads + screenshot + act |
| **Indexed loop** | Initial in-page evaluate snapshot; per mutation: resolve/act + re-observe evaluate (no per-step screenshot) |

Fixture goal: fill query, select Agency, click Go, expand FAQ (`tests/fixtures/browserAction/interactive.html` semantics).

## Gate

Indexed path must show **≥5×** fewer simulated protocol units than the naive stub before any product "10x" language. Jev's published ~10× is external evidence on a different task, not a Luminara claim.

Verifier: independent `textIncludes` checks must pass; agent `DONE` alone is not proof.
