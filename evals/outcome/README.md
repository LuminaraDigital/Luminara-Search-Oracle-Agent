# Outcome evals

Does the audit still say the right thing about a site with a known fault?

Each file under `scenarios/` is one fake website with faults put in on purpose, plus what the
audit should say about it. `tests/outcomeEvals.test.ts` serves the site from memory, runs the real
crawler-file and schema audit code against it, and scores the result. No model, no network. It
runs inside `npm test`.

## What a scenario holds

- `says`: one plain sentence per fault, stating what the product should tell the user. The owner
  confirms these. If the owner disagrees with what the code does, the scenario becomes
  `stance: 'gap'` and a Papercuts entry is written. The expectation is not edited to match the code.
- `site`: path to response.
- `expect`: every crawler check with its status, and the complete lists of fix ids and finding ids.

## Scoring

- **missed**: an expected status, fix or finding is absent. Fails a `regression` scenario.
- **invented**: a fix or finding the scenario does not expect. Always fails, `gap` included.
- **dishonest**: a file that returned a server error is reported as pass or fail, not as
  not measured. Always fails, `gap` included.

## The gate

`gate.json` lists each `regression` scenario with a fingerprint of its file and of `fakeSite.ts`.
A new or edited scenario fails the test until it is promoted:

```
npm run evals:outcome:promote
```

That rewrites `gate.json` for the scenarios that pass, so every change to an expectation shows in
the pull request diff.

## Limits

Six fixtures written by the team that wrote the checks are a regression suite, not a measure of
accuracy. A clean run means nothing got worse. Only the crawler-file and schema paths are covered;
the full audit crew runs in the browser with provider calls and is not. The scorecard is written to
`coverage/outcome-evals.json` (not tracked) and is for internal use.
