# Deterministic agent output evals

Self-hosted eval matrix for Oracle-style agent answers. Node stdlib only, no npm
deps, no promptfoo. Each case feeds a recorded `response` text through
`runAllValidators` from `worker/agentOutputValidators.ts` and asserts the
expectations under `expect:`.

## Run

```
npm run evals
```

Prints a case x check matrix (PASS / FAIL / - for unspecified checks) and a
summary line `N cases, M passed, K failed`. Exit code is 1 when any case fails.
Use `node evals/run-evals.mjs --dir <path>` to point at another case directory.

## Adding a case

Drop a `.yaml` file under `evals/cases/`. Each file is a top-level list of
maps:

```yaml
- name: my-case
  provider:
    model: recorded-fixture
  evidenceNumbers:
    - 54
  response: |
    Multi-line answer text goes here.
  expect:
    ok: true
    maxBlock: 0
    maxWarn: 1
    mustContain:
      - a substring
    mustNotContain:
      - another substring
```

Checks: `expect.ok` must equal the validator's `ok` (true means zero
block-level findings). `maxBlock` / `maxWarn` cap finding counts by severity
(maxBlock defaults to 0). `mustContain` / `mustNotContain` are raw substring
assertions on the response.

## YAML subset limitation

`evals/yaml-subset.mjs` is a tiny hand-rolled parser, not YAML. It supports
ONLY: a top-level list of maps, string scalars (numbers and true/false are
coerced), `[]` for empty lists, block scalars via `|`, one level of nested maps
under `provider:` and `expect:`, and list values under `evidenceNumbers:`,
`mustContain:`, and `mustNotContain:`. No anchors, no flow maps, no deeper
nesting. Anything else throws.

## Honesty rules cases must encode

1. Never restate a `not_measured` / `not_configured` metric as a number; the
   `notMeasuredHonesty` block must fire on such cases (`expect.ok: false`).
2. Every number near a metric term must appear in the case's
   `evidenceNumbers`; otherwise `noInventedMetrics` warns.
3. Attribution phrases (according to, studies show, ...) require a citation
   marker; write negative cases as `expect.ok: false` (pair with a not_measured
   restatement so the case blocks) and assert the validator catches them.
