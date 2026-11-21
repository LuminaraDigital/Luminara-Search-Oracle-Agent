# services/audit

Browser-side audit rules, the findings board, report blocks and their helpers.

`ruleDefinitions.ts` (Allora CL0-5) holds the rule ids, the word threshold and the schema type checks. The browser auditor and the server re-checks both import it, so the two cannot drift. Change a threshold or type list there, never in a copy.

## Decision checks: invariants

The server re-check and fix retest (spec `specs/0033-decision-check-loop.md`, plan `docs/plans/allora-concepts-implementation-plan.md` sections 2.4 and 3.3) reads rules from this folder. Any change here or in `worker/decisionChecks/` keeps these true.

### Honesty

- A check result counts as measured only when the server fetched the page in that run. It describes page source, not AI answers, and every chip says so.
- Statuses use the existing vocabulary. The words "confirmed", "verified" and "fixed" never appear in its copy. The approved card strings are listed in plan section 3.5; nothing else is shown.
- A result's detail is a code from the closed lists in `ruleDefinitions.ts`. A code selects a string and is never shown as text. A code never carries bytes from the fetched page, a header value or a redirect target.
- The check name is always shown next to its result.
- No score or derived number. No hex colours in components, no em dashes in copy, no `Math.random` in these files, comments included.

### Scope and volume

A client string never widens scope.

1. **Domain.** Normalised with `safePublicHostname` after stripping `www.`. No valid domain means no checks; the decision still saves.
2. **Target host.** http or https, default port, no userinfo, host equal to the domain or its `www` twin. Path plus query at most 1,024 characters; a normalised URL over 1,100 characters is refused, not cut.
3. **Allowance.** At most the plan's domain limit of distinct domains with checks in any rolling 30 days.
4. **Caps inside the one insert statement:** the allowance; 3 rows per decision; 30 open rows per account; 20 new rows per account per 24 hours; the per-site cap. Over a limit, the decision saves with no checks and a refusal code.
5. **Per site:** at most 12 server fetches per hour across all accounts; no fetch within 24 hours of a 403 or 429. The daily job makes at most one fetch per domain per run.
6. **Burst:** the decision route passes the rate limiter and the small-body cap. A limiter refusal, a limiter error or an unreadable switch never blocks the save.
7. **Baseline runs once,** only for rows the request inserted. An identical re-post creates nothing and fetches nothing.

`cleared` and `still_present` require a failing baseline the server recorded: the server never reports an issue as gone that it did not see.
