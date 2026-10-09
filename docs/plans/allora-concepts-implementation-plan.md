# Allora Concepts Implementation Plan (Fix Retest Loop)

**Status:** v2.2 - three review rounds applied (section 13). Awaiting owner gate. Phase 0 is cleared to start; Phases 1-2 wait on CL0-0; Phase 3a waits on owner decision 1  
**Date:** 2026-10-03  
**Owner:** Luminara Digital (owner gate before every production step)  
**Source:** "Allora: a Self-Improving, Decentralized Machine Intelligence Network" (Kruijssen et al., 2024). Concepts only.  
**Baseline:** `origin/main` at `5cbfcad`, whose tree equals `71284da`. Line numbers are from that tree.  
**Companions:** [`weekly-decision-loop-10x-ship.md`](./weekly-decision-loop-10x-ship.md) (product spine; this plan delivers its WDL6a), [`zoro-concepts-implementation-plan.md`](./zoro-concepts-implementation-plan.md) (its section 2 rules bind this plan), [`verifiable-flow-memory-10x-ship.md`](./verifiable-flow-memory-10x-ship.md) (same-day plan that overlaps on findings, rule ids and dashboard hydration; ownership is settled in section 9), [`agent-mcp-product-surface.md`](./agent-mcp-product-surface.md), [`budget-policies-and-enforcement.md`](./budget-policies-and-enforcement.md).

## 0. Verdict

### 0.1 What transfers

The paper describes a network that combines many models' numeric predictions, weights each model by how wrong it has been, and pays for it with a token. Its mechanisms need three things: several predictors of the same number, a truth measured later, and inputs a client cannot supply. The paper's own support is one synthetic simulation of a numeric target; it does not cover a yes-or-no target.

Luminara has one of the three. The audit runs in the browser, every weight is a constant, the live path produces one probe sample per engine, and no job re-measures anything. So one concept is buildable now, one becomes a bounded study, and six are parked with the reason and the condition for reopening written down.

The buildable one is the paper's first idea: record a claim, measure the truth later, show the result. Here that is a server re-check of a finding when the user commits to it, and a retest at the verify date.

### 0.2 The eight concepts

| # | Concept | Decision | Where |
|---|---|---|---|
| 1 | Score a claim against later ground truth | **Build.** Server re-check at commit, retest at the verify date | Phases 1-2 |
| 6 | Baseline comparison (the review's rule; the paper's "naive" inference is its own weighting without forecasters, a different thing) | **Adopt as a rule.** Any future estimate must beat equal weights and a base rate before it is served | Section 8; Phase 3a applies the same idea to one probe |
| 2 | Regret-weighted combining | **Park.** The live path has one sample per engine, so there is nothing to combine. Review also found the paper's weighting collapses toward one source from noise at its default constants | Section 8 |
| 3 | Context-aware weighting | **Park** behind concept 2 | Section 8 |
| 4 | Disagreement ranges | **Park.** Needs at least 3 samples per engine. Approved copy recorded | Section 8 |
| 5 | Leave-one-out attribution | **Park** behind concept 2. Corrected rule recorded | Section 8 |
| 7 | Effective count, 1/sum(share^2) | **Cut.** It would put a new derived number on a 3-query search sample, and the estimate is biased low at small counts | none |
| 8 | Capped-influence consensus | **Not applicable.** Zoro section 4 uses a fixed decision table with at most three verifiers and defers vote weighting | none |

### 0.3 Locked non-goals

- No token, staking, rewards, emissions or pay-what-you-want pricing.
- No new score or derived numeral on any surface. Outputs are statuses, dates and the name of the check.
- No change to teasers, Idea Scout cards, the landing Probe or the citability checklist. Chips and before/after never render in redacted teasers. No aggregate count across citability checks.
- No dollar or ROI claims. No causal wording.
- No client-supplied value decides a check result. The client names a rule; the server measures.
- Nothing here measures whether AI answers changed. That is WDL6b and needs WDL2 answer capture and Live keys.
- No learned weights, ranges or agreement labels are served by any phase in this plan.

### 0.4 Phases

| Phase | Ships | User-visible | Hosted spend |
|---|---|---|---|
| 0 | Findings sync fix, facts, hardened fetch, two flags, runtime off-switch, shared rule definitions | None | None |
| 1 | Server re-check at decision commit | Up to three server re-check chips on the Decision Card (finding box for rule checks, under the title for action checks) | None (plain fetches) |
| 2 | Retest job, durable card, manual retest, MCP read tool, pricing line, optional Telegram notice | Before and after on the card, on any device | None (plain fetches) |
| 3a | One-off study: is the provider truth valid, and does a probe "yes" go with the measured truth? | None | One-off, capped, owner-approved |
| Parked | Weights, ranges, attribution, context | None | None |

### 0.5 What "ready" means here

Phase 0 and Phase 1 are specified to task level against code that was read, and are a work order. Phase 2 is specified to task level too; it cannot promote until the owner has read the CL1-0 coverage report. Phase 3a is a design that waits on owner decision 1. Section 8 is a record, not a plan.

This plan is smaller than its title suggests. Two phases of product work come out of the paper; the rest is a study and a list of things not to build yet.

---

## 1. Baseline

### 1.1 Verified

| Area | Finding | Evidence |
|---|---|---|
| Audit location | The full audit runs in the browser. The server's queued audit is a minimal shell | `worker/auditQueue.ts:201-253` |
| Crew rules | Four fixed finding ids. Two are site-level and carry no URL; thin content carries URLs only inside free text; zero citations carries none. `AuditFinding` has no URL field | `services/agentCore/agents/playbookAuditorAgent.ts:52-144`, `services/agentCore/types.ts:107-126` |
| Findings sync bug | The client sends the fixed rule id as the row id; `audit_findings.id` is the primary key; the upsert conflict target is `(account_id, domain, stable_key)`. A second account, or the same account on a second domain, fails with `UNIQUE constraint failed: audit_findings.id` and the client hides the 500 | `worker/findingsService.ts:166,178-193`, `services/audit/findingBoardService.ts:134-199`. Reproduced twice on 2026-10-03 against the real migration |
| Actions | Three action ids: `deploy-schema`, `rewrite-answer`, `citation-gap`. The decision's `findingId` is the highest-severity finding, which is unrelated to the chosen action | `components/audit/ShipActionGate.tsx:12-28`, `services/audit/findingBoardService.ts:257-265`, `components/audit/WeeklyDecisionCard.tsx:43-48` |
| Decision storage | One row per `(account_id, domain, week_key)`. `domain` is trimmed and lower-cased only, so it can be a full URL or `unknown`. `verify_by` is client-controlled, defaults to 14 days out, moves on every re-post, and is never read | `worker/weeklyDecisionService.ts:49-129`, `components/audit/ReportDisplay.tsx:330`, `components/audit/InstantAuditView.tsx:909` |
| Card durability | Findings and the commitment live in session storage. `GET /weekly-decisions` defaults to the current ISO week, and `fetchWeeklyDecision` has no caller. Two of three card mounts pass no commitment. A user returning 14 days later sees nothing | `worker/weeklyDecisionService.ts:40-46`, `services/privacy/privacyClient.ts:6`, `components/suite/DashboardView.tsx:216-221` |
| Decision route | Authenticates inline; no per-route rate limit; reads the body with no size cap; the handler has no `ExecutionContext` or client IP | `worker/index.ts:1294-1307`, `worker/weeklyDecisionService.ts:24-29,50` |
| Scheduled work | One cron, `0 8 * * *`, mapped to `sentinel` and `privacy_purge`. An unmapped cron runs every job. A test hard-codes the daily job list | `wrangler.jsonc:11-13`, `worker/scheduledJobs.ts:10-33`, `worker/index.ts:1877-1885`, `tests/scheduledJobs.test.ts:20,24,35,40` |
| Public fetch | `fetchPublicUrl` re-validates host and resolution on each redirect hop, for public-ness only. No timeout, size cap, content-type check or port rule, and the DNS lookups take no abort signal. `safePublicHostname` has no public-suffix knowledge | `worker/security.ts:279-374`, `services/security/publicHostname.ts:20-32` |
| Plans | `domainLimit` is 1 on Free and the one-off SKUs, 2 on Starter, 10 on Growth, 25 on Agency. `scheduledReaudit` is `none` on Free. Plans last 30 days | `worker/telegramBot.ts:43-149` |
| Account linking | Linking updates two `users` rows and moves no other table | `worker/userStore.ts:330-338` |
| Privacy lists | Export and delete enumerate tables by hand. `audit_findings` is in neither | `worker/privacyService.ts:46-151,153-196` |
| Visibility path | One probe model per engine, run once per query, and only when the provider returned nothing measured. The measured path filters by the target domain, so it can report cited or `not_measured` but never "not cited" | `services/visibility/engineVisibilityRouter.ts:89-104`, `services/visibility/llmAnswerProbeService.ts:19-46`, `services/visibility/dataForSeoMentionsService.ts:40-49,73-98` |
| Output validators | `evidenceNumbers` is populated only in tests and evals. Oracle chat runs the validators with no context and can only execute `research_keywords` | `worker/oracleChat.ts:140-167,271`, `worker/agentOutputValidators.ts:96-183` |
| Deploy | The deploy workflow migrates, deploys and smokes for both environments, with no backup, no `concurrency` group, and without waiting for CI | `.github/workflows/deploy-cloudflare.yml:59-83,121-145` |
| Branches | `origin/main` holds a merge commit that `origin/staging` lacks, so main is not an ancestor of staging. Local `main` and `staging` are stale | `git merge-base --is-ancestor origin/main origin/staging` exits 1 |
| Tests | Vitest in node. D1 is an in-memory SQLite that applies every real migration. Its helper reports `meta.changes: 0` for `RETURNING` statements | `tests/helpers/sqliteD1.ts:26-41` |
| Honesty gates | `Math.random(` anywhere in the text of a `services/` or `worker/` file that mentions score, ranking or visibility fails the gate, comments included | `scripts/honesty-gates-lib.mjs:96-124` |

### 1.2 Not verified (each is resolved by a named task)

- The Workers plan, its CPU and subrequest limits, and whether scheduled work under `waitUntil` gets the same allowance (CL0-0). This blocks Phase 1, not only Phase 2.
- Whether remote D1 accepts `UPDATE ... RETURNING` and window functions (CL0-0).
- Whether a Worker fetching its own hostname re-enters itself. The wrapper refuses own hosts regardless (CL0-3).
- Which promotion path GitHub enforces for `main`: a pull request from `staging`, or the fast-forward push in Zoro 2.3 (CL0-0). `AGENTS.md` says main requires a pull request; recent history shows both.
- Whether the provider can return a trustworthy negative, which engines it covers, and whether its answers are fresh or from a stored corpus (CL3a-1).

---

## 2. Rules for every task

Zoro section 2 applies unchanged: gates, flags, release, rollback, migration rules, privacy rule, double-check protocol, licence keys. The deltas in `verifiable-flow-memory-10x-ship.md` section 2.1 also apply (branch from `origin/staging`, bring main back into staging before the first production step, back up before any PR that carries a migration, migrations and specs referred to by name, one concern per PR). This section adds only what is specific to this plan.

### 2.1 Flags and the runtime off-switch

String vars in all three `wrangler.jsonc` blocks, typed in `worker/env.ts`, documented in the four tracked example env files, reported as booleans in `/api/health`. Default `"false"`. An unknown value is treated as off.

| Var | Phase | Off means |
|---|---|---|
| `DECISION_CHECKS_ENABLED` | 1 | No check rows are created and no baseline fetch runs. `POST` and `GET /weekly-decisions` return exactly what they return today, with no `checks` key |
| `DECISION_RETEST_ENABLED` | 2 | The retest job claims nothing and fetches nothing. Manual retest returns 503 `RETEST_DISABLED` before any database read |

- Either flag off means zero outbound fetches from that flag's code. With the retest flag or switch off, the job still grades expired rows and purges; it only claims and fetches nothing.
- A row is never fetched after `expires_at`. There is no other lateness rule: a row that came due while a flag was off is retested on the next run and shows its real retest date.
- Runtime off-switch: KV key `decision_checks:off`. The value `checks`, `retest` or `all` names what is disabled; a missing key disables nothing. It fails closed: any other value, a read that throws, or an unbound KV disables both. Disabled means the decision still saves, no rows are created, the job claims nothing and manual retest returns 503. It is read once per request or job run. KV is eventually consistent, so allow about 60 seconds. A feature is on only when its var is `"true"` and the switch does not disable it; `/api/health` reports the var and the effective state separately.
- The switch is set and cleared with one `wrangler kv key put` or `delete`, so a fetch problem can be stopped without a deploy. The runbook holds the exact commands for both environments, and each is run once on staging before Phase 1 is promoted.
- Turning a flag on is its own PR that changes the top-level and production blocks together. A test asserts the two blocks' `vars` are equal.

### 2.2 Release deltas

- No production step, the CL0-1 hotfix included, happens before CL0-0 has recorded which promotion path GitHub enforces (the same open question as in the verifiable-flow plan).
- Before the first PR and after every production promotion: `git fetch origin`; if `git merge-base --is-ancestor origin/main origin/staging` exits non-zero, the release operator runs `git push origin origin/main:staging` (fast-forward only; today the trees are equal, so it only redeploys staging).
- Act on remote refs only. Local `main` and `staging` are stale; never check them out or push from them. Where Zoro 2.3 step 7 says `git push origin staging:main`, read `git push origin origin/staging:main`.
- Production is never deployed by `workflow_dispatch` from a branch other than `main`. Backup dumps are deleted from the operator's machine once stored.
- Promotion ships the whole staging tip. Nothing merges to staging unless it is dark in production (flag off in both blocks) or already approved for production.
- Backup command in the operator's PowerShell: `$env:CONFIRM_PROD_BACKUP='1'; npm run db:backup:prod`. Staging had zero `users` rows on 2026-10-01, so the staging backup check is "the dump contains `CREATE TABLE users`", not "contains user rows".
- After any `wrangler rollback`, read the flags on `/api/health`. A version carries its own vars, so a rollback can turn a flag back on. The KV off-switch still applies.
- No new cron expression is added in this plan (section 3.6). If one is added later, the code that maps it ships and reaches production one release before the cron is added to `wrangler.jsonc`, because an unmapped cron runs every job, Sentinel included.

### 2.3 Privacy deltas

- `decision_checks` and `audit_findings` are both added to export and to delete in CL1-1, with tests. Checks are deleted before decisions.
- Account linking moves rows only when the losing account id differs from the surviving one. In the same batch as the `users` updates, in this order: (1) `UPDATE OR IGNORE weekly_decisions SET account_id = :w WHERE account_id = :l`; (2) `UPDATE decision_checks SET account_id = :w WHERE account_id = :l AND decision_id IN (SELECT id FROM weekly_decisions WHERE account_id = :w)`; (3) move `audit_findings` with the one helper and collision rule that verifiable-flow V2-1b defines (the later `updated_at` wins), owned by whichever plan lands first; (4) delete the remaining `:l` rows from `decision_checks`, then `weekly_decisions`; (5) where two open rows now share an account, check and URL, grade the older `superseded`. Tests: no row carries the losing id; every `decision_checks.decision_id` names a decision of the same account; no two open rows share an account, check and URL; linking two logins that already share an account changes nothing.
- Stored URLs are normalised; the whole `href` is at most 1,100 characters and its path plus query at most 1,024 (3.3 rule 2). Logs and run rows from the retest job carry the check id, the host and a result code only: no account id, path or query string.
- Retention: graded rows are purged 180 days after `updated_at`. Open rows are graded `expired` at `expires_at`. Nothing is kept forever.
- The privacy page gains one sentence on stored page URLs and the scheduled re-fetch (owner decision 5).

### 2.4 Honesty rules for this subsystem

- A check result is `measured` only when the server fetched the page in that run: `pass` and `fail` map to `measured`. It describes the page source, not AI answers, and every chip says so.
- Statuses map onto the existing vocabulary. No word "confirmed", "verified" or "fixed" appears. Section 3.5 lists the only approved card strings; the other user-facing strings are the check names in 3.1, the pricing line in section 6, the tool description in CL2-6, the messages in CL2-7 and the privacy sentence in owner decision 5.
- A result's detail is a code from a closed list (3.7). The card shows only the strings in 3.5; a code selects among them and is never shown as its own text. A code never contains bytes from the fetched page, a header value or a redirect target.
- The check name is always shown, because the card title is the chosen action while the check follows a rule.
- No hex colours in components. No em dashes in copy. No `Math.random` in the new files, comments included.

### 2.5 Licence keys and subscription state

Zoro 2.8 applies. This plan reads `sub:*` only through the existing `getActiveSubscription` at commit time, where the request identity exists. It never writes or deletes `sub:*` or `license:key:*`. New KV keys use the `decision_checks:` prefix. A test with a recording KV asserts both.

Zoro 2.8's deploy check cannot be run as written: `describeLicenseKey` has no caller outside tests. For this plan the check is that no PR diff touches `worker/licenseService.ts` or writes a `license:key` or `sub:` key (grep the diff), and that the recording-KV test passes.

### 2.6 Double-check protocol

After every task:

1. Re-run the task's acceptance test and the targeted test file, and read the output.
2. `npm run typecheck`, then grep for the regression the task could cause (named in the phase's double-check line).
3. A reviewer who did not write the code reads the diff against the task row and reports blocker, major or minor findings with file and line.
4. Fix every blocker and major. Repeat steps 1-3 on the fix. A task is done only when a re-check finds nothing new.

After every phase:

1. Full gates, `npm run evals`, and the green GitHub run (tests that pass on Windows have failed on the Linux runner).
2. Staging smoke plus the phase's manual check.
3. Re-read this plan's section against the merged code and correct whichever is wrong.
4. CEO go or no-go against the phase's promotion criteria, recorded in section 13.

At the end of the plan: one closing review walks every acceptance row and every finding in section 13 and confirms each fix is present in the merged code, not only reported. A criterion that was missed is recorded as missed.

### 2.7 Execution loop

Implementation runs as a self-paced loop. One tick is one task.

| Role | Does | Must not |
|---|---|---|
| Builder (full-stack) | Implements one task row on a branch off `origin/staging`; runs the gates | Start a second task in the same PR |
| Data and Worker reviewer | Reads the diff for D1 correctness, leases, idempotency, auth, rate limits | Edit the code under review |
| Security, privacy and cost reviewer | Fetch safety, abuse caps, export and delete | Waive a cap |
| AI/ML reviewer (Phase 3a only) | Study design, resampling unit, leakage | Approve a result with no pre-registered test |
| Release operator (human) | Backups, merges, staging checks that need sign-in, production approval | Be impersonated: signed-in checks and production steps are the owner's |
| CEO reviewer | Recommends phase go or no-go, wording rulings and kill decisions. The owner decides | Add scope mid-phase |

Tick order: build, self-check, two independent reviews in parallel, fix, re-review the fix, update the status line. The loop stops and asks the owner at every row marked Operator and before every production step.

---

## 3. Design

### 3.1 What is checked

A check is a pure function over page source fetched by the server. It returns `pass`, `fail` or `not_measured` and a detail code. The thresholds and type lists live in one module, `services/audit/ruleDefinitions.ts`, imported by the browser rules and the server checks, so the two cannot drift.

| Check id | Triggered by | URLs checked | `pass` | `fail` | `not_measured` |
|---|---|---|---|---|---|
| `org_schema_present` | Rule `finding-schema-org`, or action `deploy-schema` | Site root | A JSON-LD block (including `@graph` and arrays) has type Organization, Corporation or LocalBusiness | 200, HTML, complete, no such type | Non-200, non-HTML, deadline, truncated, unparseable, off-domain redirect |
| `howto_schema_absent` | Rule `finding-deprecated-howto` | Pages whose schemas include HowTo, at most 3 | No JSON-LD type HowTo | HowTo present | As above |
| `min_words_250` | Rule `finding-thin-content` | The thin pages, at most 3 | At least 250 words of visible text | Fewer than 250 and the page is not an app shell | App shell (under 50 words and at least one script bundle), or as above |

- A decision's check set is the union of the checks triggered by its committed action and by its finding, at most 3 rows. On de-duplication the rule trigger wins. When the union exceeds 3 rows the action row is kept first. Results roll up per check, never across checks.
- Check names shown to users, as a closed list: "Organization schema", "HowTo schema", "Page text length".
- No check exists for `finding-zero-citations`, or for the actions `rewrite-answer` and `citation-gap`. Those decisions show "Server re-check: not available for this finding". No phase in this plan measures them.
- The crawler-file checks (`llms.txt`, robots directives) are not in this version: no finding or action maps to them today, and their fetcher is shared with the landing Probe, which must not change.
- Method limit, shown with every result: the server reads page source, so content added by scripts is not seen. Baseline and retest use the same method, so the comparison is like for like.
- Parsing is a linear scan with no backtracking patterns: at most 20 script blocks of 100 KB each.

### 3.2 Where the server gets its inputs

- The crew attaches `ruleId` and `targetUrls` to each finding (new optional fields on `AuditFinding`). They are stored in `audit_findings.evidence_json` under `provenance`, the shape the verifiable-flow plan defines.
- At commit the server reads the rule id and URLs from the caller's synced `audit_findings` row and the action id from the decision's `commitment_json`. It never takes a check id, a result or a URL list from the `POST /weekly-decisions` body.
- Those rows are written by the client through findings sync, so the URLs are still client-supplied. What bounds them is 3.3, not their origin.
- A rule id or action id that is not in the registry creates no rows.

### 3.3 Scope and volume rules

A client string never widens scope.

1. **Domain.** `safePublicHostname(body.domain)` after stripping `www.`; null means no checks are created and the decision still saves. `weekly_decisions.domain` is left as posted, so flag-off behaviour is unchanged; the normalised value is stored on the check row.
2. **Target host.** A target URL must be http or https, default port, no userinfo, with a host equal to the normalised domain or `www.` plus it. Other subdomains are not checked in this version, which removes the need for a public-suffix list. Path plus query at most 1,024 characters, fragment dropped, stored as the normalised `href`. A normalised `href` over 1,100 characters is refused before the insert, not truncated.
3. **Allowance.** An account may hold checks for at most `planCapsFor(plan).domainLimit` distinct domains in any rolling 30 days.
4. **Caps, all enforced as conditions inside the one insert statement**, so concurrent requests cannot each pass a separate read: the allowance in rule 3 (`COUNT(DISTINCT domain)` over the account's rows of the last 30 days, excluding this domain, below the limit); at most 3 rows per decision; 30 open rows per account, counting `not_run` rows created in the last minute and not counting open rows past `expires_at`; 20 rows created per account per rolling 24 hours; and the per-site fetch cap below. Over a limit, the decision saves and the response carries `checks: []` and `checkRefused: <code>`.
5. **Per-site fetch cap.** At most 12 server fetches per site per rolling hour across all accounts, where a site is the normalised domain (its `www` twin shares the `domain` column), and a fetch is a row whose `baseline_at` or `retest_at` falls inside the hour (rows are found through `updated_at`, which every such write sets). The same condition is in the manual-retest claim. The daily job is exempt from the cap and from the backoff, since it makes at most one fetch per domain per day. Redirect hops are not counted, so the worst case is 48 requests per site per hour. Backoff uses the same kind of condition: no fetch when a row for the site recorded HTTP 403 or 429 inside the last 24 hours; code `host_backoff`.
6. **Burst.** With the flag on, `POST /weekly-decisions` passes the dual rate limiter (10 per minute per account and per IP) and reads its body through `readBody` with the small-body cap. The limiter and the off-switch never block the save: on a limiter refusal, a limiter error or an unreadable switch, the decision saves, no rows are created and `checkRefused` is `rate_limited` or `unavailable`.
7. **Baseline runs once.** The baseline runs only for rows this request inserted. An identical re-post creates no rows and fetches nothing. A re-post that changes the action or finding inserts only the rows new to the check set, inside the same caps, and grades `superseded` the open rows whose trigger left it (3.4).

Accepted residuals: any signed-in account may name any public site as its domain, within the allowance and the caps above (this is narrower than the crawler-file and Probe routes already in production); other accounts can use up a site's hourly budget, which delays a check and never falsifies one; a privacy delete removes the rows the caps count.

### 3.4 Lifecycle

```
commit -> rows inserted as graded, outcome not_measured, baseline_code not_run
       -> baseline inside one 6 s budget, written only where baseline_code is still not_run
  baseline fail          -> state open, due_at fixed
  baseline pass          -> graded, outcome not_reproduced
  baseline not_measured  -> graded, outcome not_measured   (no automatic retry)

open, at due_at -> retest (auto_retest = 1 only)
  retest pass            -> graded, outcome cleared
  retest fail            -> graded, outcome still_present
  retest not_measured    -> retried on the next daily run, 3 attempts, then graded not_measured

manual retest (once per decision per 24 h, any plan, until expires_at)
  runs on: open rows not under a live lease, and graded rows whose outcome is not_measured or still_present
  row whose baseline_status is not_measured, whatever its code -> the run is recorded as the baseline:
    fail opens the row and sets outcome to NULL; pass grades it not_reproduced; not_measured leaves it graded
    (this write is guarded on baseline_status = 'not_measured', not on the not_run code)
  row whose baseline was fail:
    pass                 -> graded, outcome cleared
    fail before due_at   -> stays open; retest_status recorded; a scheduled retest, if the row has one, still runs
    fail at or after due -> graded, outcome still_present
    not_measured         -> state and outcome unchanged; retest_status, retest_code, retest_http_status and
                            retest_at are recorded, so the cap and backoff in 3.3 rule 5 see the fetch

open past expires_at     -> graded, outcome expired, no fetch
3 claimed attempts with no result -> graded, outcome not_measured, code attempts_exhausted
same check and URL committed again under a newer decision -> older open row graded superseded
a re-post that changes the action or finding of the same decision -> open rows whose trigger left the check set graded superseded
```

- `cleared` and `still_present` require `baseline_status = fail`. The server never reports an issue as gone that it did not see.
- A row is never open without a real baseline. It is inserted already graded as `not_measured` with code `not_run`, and only a completed baseline can open it. A request that dies between the insert and the fetch leaves a graded row that is never retested automatically. So that concurrent requests cannot overshoot, the 30-open cap also counts `not_run` rows created in the last minute.

- `due_at` is set once at row creation as `committedAt + 14 days`, clamped to between 1 and 60 days from now, and never changes. `expires_at` is `due_at + 30 days`.
- `auto_retest` is fixed at commit from the caller's plan and is never flipped by the job. A plan that lapses before the verify date still gets the retest it was sold. The job confirms only that the account still exists.
- Roll-up is per check, never across checks. Baseline: any `fail` shows "same issue found", else any `not_measured` shows not measured, else "issue not found". Retest, over the check's rows whose baseline was `fail` (`not_reproduced` and `superseded` rows are left out): any `retest_status` of `fail` shows the still-found string; else all `cleared` shows the no-longer-found string; else, once a retest was attempted, not measured; before any retest, the open-state string.

### 3.5 Approved strings

No chip when signed out, when there is no server decision, or in any teaser. A superseded row shows nothing; the card shows the newest decision.

Rows triggered by the finding render inside the finding box. When no finding box is rendered, they render in the same block under the card title as action rows, with the check name first:

| Moment | String |
|---|---|
| Baseline fail | "Server re-check: same issue found" |
| Baseline pass | "Server re-check: issue not found" |
| Baseline not measured | "Server re-check: not measured" |
| No check exists | "Server re-check: not available for this finding" |
| Retest pass | "Retest {date}: issue no longer found in page source" |
| Retest fail | "Retest {date}: issue still found in page source" |
| Retest not measured | "Retest {date}: not measured" |

Rows triggered by the action render on their own line under the card title, never inside the finding box, because the box may show a different finding:

| Moment | String |
|---|---|
| Baseline fail | "Server check for this action: no Organization schema in page source" |
| Baseline pass | "Server check for this action: Organization schema already in page source" |
| Baseline not measured | "Server check for this action: not measured" |
| Retest pass | "Retest {date}: Organization schema now in page source" |
| Retest fail | "Retest {date}: still no Organization schema in page source" |
| Retest not measured | "Retest {date}: not measured" |

Shared strings:

| Moment | String |
|---|---|
| Open, automatic retest | "Automatic retest on {date}" |
| Open, manual only | "Verify date: {date}" |
| Expired | "Retest window closed on {date}: not measured" |
| Refused by plan allowance | "Server re-check: not run. Plan limit of {n} sites reached." |
| Refused by a rate cap | "Server re-check: not run. Try again later." |
| Detail line, one per URL | "{check name}. Read from the page source of {url} on {date}. Content added by scripts is not seen. This checks your page, not AI answers." |
| Button | "Retest now" and, when refused, "Next retest available {time}" |
| Fixed caveat under before/after | "This compares your page source on two dates. It does not show that AI answers changed." |

Every date and time on the card comes from the server (`baseline_at`, `due_at`, `retest_at`, `expires_at`, `nextAllowedAt`), never from a date computed in the browser. A row graded with no retest time shows its `updated_at`.

While the retest flag is off an open row shows "Verify date: {date}" and no button.

### 3.6 The retest job

- The job is a third entry on the existing daily cron: `0 8 * * *` maps to `sentinel`, `privacy_purge` and `decision_retest`. No new cron expression, so there is no rollback hazard and no extra invocations. With a 14-day verify window, daily is enough.
- One run: read the off-switch; grade expired rows and rows that used up 3 attempts; claim a batch; run the checks concurrently, each under the wrapper's 5 s total deadline; write results; purge graded rows older than 180 days; stamp the run time in KV key `decision_checks:last_run` (a different key from the off-switch, so the job can never undo a pause).
- The daily invocation is shared with Sentinel, which can make several fetches for each of up to 500 targets, and subrequests are counted per invocation. The dispatcher runs `decision_retest` first and awaits it, inside a try/catch, before starting Sentinel, so the retest always has its budget and a retest failure never stops Sentinel. CL0-0 records Sentinel's target count and subrequests per run.
- Claim, one statement, at most one row per domain per run, tested on SQLite 3.51:

```sql
UPDATE decision_checks
SET lease_until = ?1, retest_attempts = retest_attempts + 1, updated_at = ?2
WHERE id IN (
  SELECT id FROM (
    SELECT id, due_at,
           ROW_NUMBER() OVER (PARTITION BY domain ORDER BY due_at, id) AS rn
    FROM decision_checks
    WHERE state = 'open' AND baseline_status = 'fail' AND auto_retest = 1 AND due_at <= ?2
      AND retest_attempts < 3
      AND (lease_until IS NULL OR lease_until < ?2)
      AND domain NOT IN (
        SELECT domain FROM decision_checks
        WHERE lease_until IS NOT NULL AND lease_until >= ?2)
  ) WHERE rn = 1 ORDER BY due_at, id LIMIT ?3
) RETURNING *;
```

- The attempt counter rises in the claim, not on the result write, and the claim refuses a row at 3 attempts, so a page that crashes the run cannot be retried forever. Before each claim the job grades `not_measured`, with code `attempts_exhausted`, every open automatic row at 3 attempts whose lease has ended.
- Results are written with a fenced update, `... WHERE id = ? AND account_id = ? AND lease_until = ? AND state = 'open' RETURNING id`, never an upsert. A row deleted while leased is not recreated, a stale worker writes nothing, and a row a manual retest graded in the meantime is not overwritten. A result notice is sent only when that write returned the row.
- The manual-only reminder (CL2-7) is a separate step of the run: a fenced update stamps `notified_at` on open rows with `auto_retest = 0`, `due_at <= now` and `notified_at IS NULL`, and a message is sent only for the rows that update returned.
- The stale-run check lives in `scheduled()`, before the runners, so a runner that throws on entry still produces the alert.
- One `now` per run feeds the due test, the lease, expiry and purge.
- Batch size is a constant set from CL0-0. Until then it is 5, and a run must finish inside 25 s of wall clock. If the daily backlog exceeds one batch for 3 days running, a second cron is added by the two-step rule in 2.2.
- A decision with 3 rows on one domain grades over 3 daily runs. Manual retest covers a user who wants it sooner.

### 3.7 Data model

Migration `decision_checks` (numbered at PR time; another session has already taken `0018` and spec `0015` in the working tree). Applied and re-applied cleanly on top of every migration in the tree.

```sql
CREATE TABLE IF NOT EXISTS decision_checks (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  decision_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  target_host TEXT NOT NULL,
  target_url TEXT NOT NULL CHECK (length(target_url) <= 1100),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('rule','action')),
  trigger_id TEXT NOT NULL,
  check_id TEXT NOT NULL,
  baseline_status TEXT NOT NULL CHECK (baseline_status IN ('pass','fail','not_measured')),
  baseline_code TEXT NOT NULL,
  baseline_http_status INTEGER,
  baseline_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  auto_retest INTEGER NOT NULL DEFAULT 0,
  retest_status TEXT CHECK (retest_status IS NULL OR retest_status IN ('pass','fail','not_measured')),
  retest_code TEXT,
  retest_http_status INTEGER,
  retest_at INTEGER,
  retest_attempts INTEGER NOT NULL DEFAULT 0,
  manual_retest_at INTEGER,
  notified_at INTEGER,
  outcome TEXT CHECK (outcome IS NULL OR outcome IN
    ('cleared','still_present','not_reproduced','not_measured','superseded','expired')),
  state TEXT NOT NULL CHECK (state IN ('open','graded')),
  lease_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (decision_id, check_id, target_url),
  CHECK (state <> 'graded' OR outcome IS NOT NULL),
  CHECK (state <> 'open' OR outcome IS NULL)
);
CREATE INDEX IF NOT EXISTS idx_decision_checks_due ON decision_checks(state, due_at);
CREATE INDEX IF NOT EXISTS idx_decision_checks_account_state ON decision_checks(account_id, state);
CREATE INDEX IF NOT EXISTS idx_decision_checks_decision ON decision_checks(decision_id);
CREATE INDEX IF NOT EXISTS idx_decision_checks_site ON decision_checks(domain, updated_at);
CREATE INDEX IF NOT EXISTS idx_decision_checks_lease ON decision_checks(lease_until) WHERE lease_until IS NOT NULL;
```

- `state` has no default on purpose: every insert names it together with its outcome.
- No column holds fetched text. `*_code` is from a closed list in `services/audit/ruleDefinitions.ts`, imported by the server checks and the client label helper, never by the browser auditor.
- Result codes (`baseline_code`, `retest_code`): `ok`, `type_missing`, `howto_present`, `too_short`, `app_shell`, `http_error`, `not_html`, `deadline`, `truncated`, `unparseable`, `redirect_off_domain`, `refused_host`, `not_run`, `attempts_exhausted`.
- Refusal codes (`checkRefused` in the response, never stored): `no_domain`, `plan_limit`, `decision_cap`, `open_cap`, `daily_cap`, `site_cap`, `host_backoff`, `rate_limited`, `unavailable`. `plan_limit` shows the plan-limit string in 3.5; `no_domain` shows no chip; every other code shows "Server re-check: not run. Try again later."
- A manual retest is refused with 429 and `nextAllowedAt`: `RETEST_TOO_SOON` for the 24-hour rule, `SITE_BUSY` for the per-site cap or backoff. Both show "Next retest available {time}".
- `target_host` is the host of `target_url` (the domain or its `www` twin), kept for logs. No cap, claim or index reads it.
- `notified_at` is the marker for "at most one message per decision" (CL2-7). It is in the table from the start because later migrations may not alter it.
- This plan writes no `audit_evidence` rows. Whether a server re-check should also count as worker-fetched evidence is a verifiable-flow decision (section 9).

### 3.8 The fetch wrapper

`worker/publicFetch.ts` wraps `fetchPublicUrl`. Zoro P1-3 reuses it and keeps only its own verifier on top.

- GET only, fixed headers, no caller-supplied init, no cookies. `User-Agent: LuminaraOracle/1.0 (+https://luminarasuite.com)`.
- One overall deadline of 5 s that covers the DNS lookups and every hop. The lookups receive the abort signal.
- At most 3 redirects. Each hop must stay on the target host or its `www` twin, default port only. Anything else is `not_measured` with code `redirect_off_domain`.
- Refused hosts: the Worker's own (`WEBAPP_URL`, `ALLOWED_ORIGINS`, `*.workers.dev`).
- HTML and plain text only. The body is streamed, capped at 512 KB of decompressed bytes, and the reader is cancelled at the cap.
- The wrapper keeps no state. The 24-hour backoff after a 403 or 429 is the stored-row condition in 3.3 rule 5, applied by the commit insert and the manual-retest claim.
- Accepted residual: the address can change between the check and the fetch, because a Worker cannot pin an address. No response bytes are ever returned to the caller, so this is not a read primitive.

---

## 4. Phase 0 - Groundwork

**Goal:** fix what the later phases stand on. Nothing user-visible.

| ID | Task | Files | Acceptance |
|---|---|---|---|
| CL0-1 | **Hotfix, ships alone and first.** The server always mints the row id. The client's rule id is kept as `evidence_json.provenance.ruleId`, restricted to `[a-z0-9-]` and 64 characters (which also excludes server and stable-key ids). Evidence is merged, never replaced, when the client sends none. The client patches by stable key while a row is unsynced, and local ingest keeps a synced server id. Legacy rows whose id is a rule id keep working. | `worker/findingsService.ts`, `services/audit/findingBoardService.ts`, `tests/findingsBoard.test.ts` | Through `worker.fetch` with the real client payload: two accounts, and one account on two domains, upsert the same rule id; all return 200 and each reads back only its own row. A re-audit updates in place and keeps the row id. A PATCH by stable key from an unsynced client succeeds. A bulk call with no evidence leaves stored evidence intact. |
| CL0-0 | **Operator and agent, read-only. Blocks Phase 1.** Record the Workers plan with its CPU and subrequest limits (on the Workers Free plan Phases 1-2 cannot run: stop and report). Confirm `RETURNING` and window functions on staging D1. Confirm cron inheritance from a real staging deploy log line, not a dry run. Record what GitHub enforces for `main` (required checks, required pull request) and write the one promotion path into 2.2. Record Sentinel's target count and subrequests per run, since the retest job shares its invocation. Count accounts with a `get_visibility_snapshot` call in the last 30 days: an upper bound on who reaches the estimated path, since only measured runs are logged (input to owner decision 1). | this document | The 1.2 items it owns moved to 1.1 with evidence. Batch size and the 25 s run budget confirmed or changed. |
| CL0-2 | Design record. A spec for the decision check loop (what, why, alternatives; no line numbers), numbered at PR time. `services/audit/README.md` or the nearest existing README gains the invariants from 2.4 and 3.3. One line under Related plans in `AGENTS.md`. The cross-plan edits in section 9, as their own docs PR. | `specs/`, README, `AGENTS.md`, the companion plans | `tokens:check` and `secrets:check` pass. Each companion plan carries its one-line edit. |
| CL0-3 | Fetch wrapper per 3.8. `resolvesToPublicAddress` gains an optional signal. `isPrivateIp` treats `::/96`, `fec0::/10`, `2001::/32` and `100::/64` as private. | new `worker/publicFetch.ts`, `worker/security.ts`, `tests/publicFetch.test.ts` | A slow lookup hits the deadline. A body over the cap is cut and flagged. A PDF is refused. A non-default port is refused. An own host is refused. A redirect to another host is refused at the hop. The IPv6 forms `::127.0.0.1`, `::7f00:1`, `0:0:0:0:0:ffff:7f00:1` and `fec0::1` are refused. The new ranges are parsed prefixes, not text prefixes: `2001:4860:4860::8888` and `2606:4700:4700::1111` stay public. Existing callers of `fetchPublicUrl` behave as before. |
| CL0-4 | Flag plumbing for the two vars and the KV off-switch per 2.1. `/api/health` adds `decisionChecks: { checksVar, retestVar, checksOn, retestOn, lastRunAt }` read from KV, with no database query and no counts. `validate-env` rejects a present but unknown value and stays silent when a var is absent. The runbook's pause section (the exact KV put and delete commands for both environments) ships here, not in Phase 2. | `wrangler.jsonc`, `worker/env.ts`, `worker/index.ts`, `scripts/validate-env.mjs`, example env files, new `tests/decisionCheckFlags.test.ts`, new `docs/runbooks/decision-checks.md` | A vitest reads the real `wrangler.jsonc` and asserts all three blocks declare each var as `"true"` or `"false"` (so the PR that turns a flag on for a staging soak still passes) and that top-level `vars` equal production `vars`. `tests/tonAddress.test.ts` still passes. With the switch set to `checks`, `retest` or `all`, the matching effective flag is off even when the var is `"true"`. An unknown value, a read that throws and an unbound KV each disable both. |
| CL0-5 | Shared rule definitions: one module holds the schema type list and the 250-word threshold, and the browser auditor imports only those two. The app-shell rule is server-only, because the browser has no such rule today and importing it would drop findings. The closed code lists (3.7) live in the same module. Add optional `ruleId` and `targetUrls` to `AuditFinding` and set them in the four rules (the origin of the first scraped page for the schema rule, the HowTo pages, the thin pages, none for zero citations). The second copy of the threshold in the reflection service uses the module too. | new `services/audit/ruleDefinitions.ts`, `services/agentCore/agents/playbookAuditorAgent.ts`, `services/agentCore/types.ts`, `services/audit/findingBoardService.ts`, `services/audit/postAuditReflectionService.ts`, tests | The crew's findings and health score for the existing fixtures are unchanged. A new fixture with a 30-word page still raises the thin-content finding. Each finding carries its rule id; URL lists never exceed 3. The honesty baseline count does not rise. |

**Order:** CL0-1 alone. CL0-0 in parallel. Then CL0-3, CL0-4, CL0-5 as independent PRs, and CL0-2 last so the spec describes what was built.

**Phase 0 double-check:** the two-account findings test through `worker.fetch`; grep the new files for `Math.random`; every existing caller of `fetchPublicUrl` still has a passing test; `/api/health` on staging shows both flags off.

**Promote when:** CI green and staging smoke green. No soak: nothing new runs.

---

## 5. Phase 1 - Server re-check at commit

**Goal:** when a signed-in user commits a weekly action, the server measures the claim itself and the finding box says whether it found the same issue.

**Who gets it:** every signed-in plan, for up to `domainLimit` domains (Free and one-off SKUs 1, Starter 2, Growth 10, Agency 25).

| ID | Task | Files | Acceptance |
|---|---|---|---|
| CL1-0 | Re-baseline. Re-check every citation in sections 1 and 3. Record which action ids and rule ids map to a check. | this document | Section 3.1 confirmed or corrected. **Coverage rule:** fourteen days after the flag is on in production, if fewer than half of decisions have a measured baseline, report to the owner before Phase 2 promotes. (Staging has no users and the fixtures are written by the team, so coverage cannot be judged earlier.) |
| CL1-1 | Migration per 3.7; smoke lists; export and delete for `decision_checks` and `audit_findings`; account-link move per 2.3. | `migrations/`, `scripts/smoke-check.mjs`, `worker/privacyService.ts`, `worker/userStore.ts`, `worker/privacyPolicy.ts`, tests | Applies on a fresh database and re-applies. Export includes both tables. Delete removes both. The four link tests in 2.3 pass: no row carries the losing id, every check names a decision of the same account, no two open rows share an account, check and URL, and linking logins that already share an account changes nothing. The privacy page contains the sentence approved in owner decision 5. |
| CL1-2 | Check registry per 3.1 as pure functions over text, returning a status and a code. | new `worker/decisionChecks/checks.ts`, `tests/decisionChecksRegistry.test.ts`, fixtures under `tests/fixtures/decision-checks/` | One fixture per cell of the 3.1 table: `@graph` nesting, array types, malformed JSON-LD, app shell, truncated body, 404, PDF, 25 script blocks. A page whose JSON-LD and title contain a marker string: the marker is absent from the result. |
| CL1-3 | Characterisation test for `/weekly-decisions` as it is today, written before any change to the route. | new `tests/weeklyDecisions.test.ts` | Pins the current `POST` and `GET` responses and rows. This is the flag-off parity oracle for CL1-4. |
| CL1-4 | Baseline at commit per 3.2-3.4. The route gains the request context and IP, the rate limiter, `readBody`, the domain rule and the atomic caps. The decision's `findingId` is resolved within the caller's account in this order: row id; stable key; then normalised domain plus `provenance.ruleId`. A legacy row whose id is a registry rule id is its own rule id. The row's domain must equal the decision's normalised domain. Rows are created with one `INSERT ... SELECT ... WHERE` per row that enforces every cap in 3.3, already graded with code `not_run`; then the baseline runs for the inserted rows inside one 6 s budget and is written only where the code is still `not_run`. Each refusal emits the structured event `decision_check_refused {code}`. `GET /weekly-decisions` returns the rows with the decision. | `worker/index.ts`, `worker/weeklyDecisionService.ts`, new `worker/decisionChecks/service.ts`, tests through `worker.fetch` | Flag off: CL1-3 still passes unchanged and responses have no `checks` key. Flag on: a failing page gives `fail, open`; a passing page gives `not_reproduced`; a deadline gives `not_measured, graded`. An identical re-post creates no rows and fetches nothing (fetch spy). A page whose source contains a marker string leaves the marker out of the stored row, both responses and every log line. Refused with the decision still saved: a target URL on a different host (for domain `co.uk`, a URL on `bank.co.uk`), a 4th row for one decision reached by a second post after findings sync added a URL, the 21st row in 24 hours, a second domain on Free (also when two posts for different domains race), the 31st open row, the 13th fetch of one site in an hour. A fetch that never returns leaves no open row. A limiter refusal, a limiter error and an unreadable switch each save the decision with no rows and no 5xx. No field of the `/weekly-decisions` body sets a status, a code or a URL. A target on any host other than the normalised domain or its `www` twin is refused. When the union exceeds 3 rows the action row is kept first, then rule URLs in order. |
| CL1-5 | Chips per 3.5, from a pure label helper. | `components/audit/WeeklyDecisionCard.tsx`, new `services/audit/decisionCheckLabels.ts`, `services/privacy/privacyClient.ts`, tests on the helper | Every baseline row, the two refusal rows and the detail line of the 3.5 tables render from their state. While the retest flag is off an open row shows "Verify date: {date}" and no button; the automatic-retest line, the expired line, the button and the fixed caveat ship in CL2-4. A rule-triggered row renders in the finding box; an action-triggered row renders under the title and never in the finding box. The check name is always present. No chip when signed out, when the server returned no decision, or in a teaser. |

**Order:** CL1-0 first. Then CL1-1, CL1-2 and CL1-3 as independent PRs, with CL1-3 before CL1-4. Then CL1-4, then CL1-5. The CL1-0 coverage rule is read fourteen days after the production flag and gates Phase 2 promotion.

**Phase 1 double-check:** the flag-off parity test; grep for any write to `baseline_status` outside the check runner; confirm the wrapper is only ever called with a URL that passed 3.3 rule 2; the marker-string test; the privacy and link tests.

**Staging soak:** 3 days with the flag on. Manual check (owner, Firebase sign-in on staging, using the owner's own provider key because staging has no hosted keys): commit a decision on a site with no Organization schema and on one with it; both chips are correct and name the check.

**Promote when:** the manual check passes; no 5xx from `/weekly-decisions` in the soak; every commit request in the soak completes in under 7 s, read from the Worker request log; and the KV off-switch put and delete have each been run once on staging (2.1). The code promotes with the flag off; the flag turns on in production only after the privacy sentence is published (owner decision 5).

---

## 6. Phase 2 - Retest and before/after

**Goal:** at the verify date the server re-runs the same page checks and the card shows before and after, on any device. This delivers WDL6a (was the issue still there). It does not measure whether AI answers changed; that is WDL6b.

**Who gets what:**

| Capability | Free | Starter | Growth | Agency |
|---|---|---|---|---|
| Server re-check chip at commit | Yes | Yes | Yes | Yes |
| Domains with checks | 1 | 2 | 10 | 25 |
| Manual retest, once per decision per 24 h | Yes | Yes | Yes | Yes |
| Automatic retest at the verify date | No | Yes | Yes | Yes |
| MCP `get_weekly_decision` | No | No | Yes | Yes |

One-off SKUs behave as Free. Pricing copy calls this "Automatic fix retest at your verify date", never a re-audit.

| ID | Task | Files | Acceptance |
|---|---|---|---|
| CL2-0 | **Durable card read.** With the checks flag on, `GET /weekly-decisions?latest=1` (optionally with `domain`) returns the caller's most recent decision that has check rows, found through `decision_checks` by account and, when given, the normalised domain, because `weekly_decisions.domain` may hold a raw URL. The response carries the rows and the decision's finding (title, severity, category, status), so the finding box renders without session storage. Without `latest`, every form of the request answers as it does after CL1-4, including the 400 when `domain` is missing. With the flag off it answers exactly as today and CL1-3 passes. `WeeklyDecisionCard` loads it itself when signed in, so all three mounts get it; the dashboard asks with no domain and renders the card from the response when there are no session findings. | `worker/weeklyDecisionService.ts`, `services/privacy/privacyClient.ts`, `components/audit/WeeklyDecisionCard.tsx`, `components/suite/DashboardView.tsx`, `worker/README.md`, tests | In a fresh browser profile with no domain in storage, 14 days after commit, the dashboard shows the finding, the baseline and the retest. With an explicit `week` and the flag on, the response is the CL1-4 response. With the checks flag off, every form is as today. |
| CL2-1 | Job plumbing: add `decision_retest` to the job type, to `ALL_SCHEDULED_JOBS` and to the daily cron's entry; dispatch through a `Record<ScheduledJobName, runner>` so a job without a runner fails typecheck; add `decision_retest` to `RunSurface`. | `worker/scheduledJobs.ts`, `worker/index.ts`, `worker/runProvenance.ts`, `tests/scheduledJobs.test.ts` | The daily cron runs three jobs. The four assertions that hard-code two jobs are updated on purpose. `wrangler.jsonc` crons are unchanged. |
| CL2-2 | The job per 3.6. A run row is opened only when rows were claimed. | new `worker/decisionChecks/retestJob.ts`, tests with the SQLite helper and a fake fetcher (asserting on returned rows, since the helper reports zero changes for `RETURNING`) | Two overlapping runs grade each row once. A stale lease holder writes nothing. A row a manual retest graded while it was leased is not overwritten. Three `not_measured` attempts end as `not_measured`; a row claimed three times with no result write is graded `not_measured` with code `attempts_exhausted` and never claimed a fourth time. With the flag off the run still grades expired rows and purges. A row whose baseline was not `fail` is never claimed. The retest runs to completion before Sentinel starts, and a retest that throws does not stop Sentinel. A row not yet due is untouched. A row past `expires_at` is graded `expired` with no fetch. At most one row per domain per run. Flag or KV switch off: zero claims and zero fetches. A deleted account's rows are not recreated. |
| CL2-3 | Manual retest: `POST /weekly-decisions/retest` with `{ decisionId }`. Flag off returns 503 before any read. Ownership miss returns 404 for both absent and not yours. Burst limiter of 5 per minute. The 24-hour rule is one D1 claim that sets `manual_retest_at` on the decision's eligible rows (3.4) only if no row of that decision was manually retested in the last 24 hours, and skips rows under a live lease; a refusal is 429 `RETEST_TOO_SOON` with `Retry-After` and `nextAllowedAt`. The per-site cap and backoff apply. The route gets its own entry in the protected-route list. | `worker/index.ts`, `worker/authMiddleware.ts`, `worker/weeklyDecisionService.ts`, `worker/decisionChecks/service.ts`, `worker/README.md`, tests | Another account's decision returns 404. Two concurrent calls: one runs, one gets 429 with the right time. A manual `fail` before `due_at` leaves the row open. |
| CL2-4 | Card before/after per 3.5, with the roll-up rule and the fixed caveat. | `components/audit/WeeklyDecisionCard.tsx`, `services/audit/decisionCheckLabels.ts`, tests | Every outcome except `superseded` renders; `superseded` renders nothing. No causal wording. The Retest button shows the next allowed time when refused, for both refusal codes. |
| CL2-5 | Observability and runbook. Structured event `decision_retest_run {claimed, graded, notMeasured, expired, ms}`. The dispatcher in `scheduled()`, before the runners, logs with the existing admin alert tag when the previous run stamp is older than 26 hours with the flag on; the job does the same when any open row with automatic retest is more than 3 days past due. Smoke warns, and does not fail, on a missing or stale stamp. The runbook gains: clear stuck leases, purge one account's rows, read the backlog. | `worker/index.ts`, `worker/decisionChecks/retestJob.ts`, `scripts/smoke-check.mjs`, `docs/runbooks/decision-checks.md` | A deploy that first turns the flag on passes smoke with no run yet. A stale stamp produces the alert line. No event carries an account id, path or query. |
| CL2-6 | MCP tool `get_weekly_decision`, off the promotion path. Free of credits, read-only. Returns the most recent decision for a project or domain and its check rows. It omits `confidence`, keeps each evidence row's `label` and `measurementStatus`, and resolves by `account_id` and normalised domain, never by `project_id` alone. Rows labelled Sample are left out of the output. Description: "Uses no credits. Read-only. Returns the most recent weekly decision for a project or domain and its server re-checks. A re-check result is pass, fail or not_measured and describes page source only, not AI answers." | `worker/mcpServer.ts`, `worker/mcpGovernance.ts`, `tests/mcpGovernance.test.ts` (assert over the live catalogue, not a hand list), `tests/apsMcp.test.ts`, `components/settings/McpUsageStrip.tsx`, `AGENTS.md` invariant 1, `specs/0004`, `docs/plans/agent-mcp-product-surface.md`, `worker/README.md` | Governance entry is `read`. Another account's project returns not found. Growth can call it; Free and Starter get `MCP_ACCESS_REQUIRED`. The result contains codes, never page text: the marker-string page from CL1-4 leaves no marker in the tool result. |
| CL2-7 | Telegram notice, after promotion, behind owner decision 4. At most one message per decision to the account's own chat, marked by `notified_at`; none for expired or superseded rows. The result message is sent when the decision's last open automatic row is graded; the reminder on the first daily run at or after `due_at` (3.6). Automatic retest: "Retest for {domain} on {date}: the issue is no longer found in your page source ({check}). This checks your page, not AI answers." (or "is still found"), or "Retest for {domain} on {date}: not measured ({check}). Open Luminara and tap Retest now." Manual only, at the verify date: "Your verify date for {domain} is today. Open Luminara and tap Retest now." | `worker/decisionChecks/retestJob.ts`, `worker/telegramBot.ts`, tests | At most one message per decision. No message without a linked Telegram chat. Not a promotion blocker: staging has no bot. |
| CL2-8 | Pricing copy: "Automatic fix retest at your verify date" on the pricing page and in the plan descriptions. Ships in the PR that turns the retest flag on in production, not before. | `components/PricingPage.tsx`, `worker/telegramBot.ts` plan descriptions, `services/plans/planEntitlements.ts` | The line appears only for Starter and above, and never says re-audit. |

**Order:** CL2-0 and CL2-1 first. Then CL2-2 and CL2-3, then CL2-4 and CL2-5. CL2-6 any time after CL2-0, off the promotion path. CL2-8 in the PR that turns the retest flag on in production. CL2-7 after promotion and only on owner decision 4.

**Phase 2 double-check:** the overlap test; grep every caller of the check runner and confirm each passes the scope rules; confirm the job never reads or writes `sub:*`; confirm no response or log line contains fetched text; re-run CL1-3 with both flags off.

**Staging soak:** 7 days. To exercise it without waiting 14 days, the owner commits decisions on staging and the operator sets `due_at` to now on those rows with one `wrangler d1 execute`. Expect one row per domain to grade on each daily run.

**Promote when:** every staged row graded exactly once; no domain claimed more than once per run; the run stamp never older than 26 hours during the soak; the owner has seen a correct before and after **in a fresh browser profile**; and the CL1-0 coverage report has been read by the owner.

---

## 7. Phase 3a - One-off study (owner-gated)

**Goal:** answer two questions with one bounded measurement, before building anything. Is the provider's measured result a valid truth? On a chosen panel, does a per-prompt probe "yes" go with the measured truth?

This is a study, not a system: one admin route, no migration, no cron, no served output. Here "probe" means the per-engine answer probe behind the `estimated` path, not the landing Probe of 0.3.

**What it can and cannot say.** It can say whether, on a chosen panel where the provider can measure and about half the items are cited, a probe yes is cited more often than a probe no. It cannot say how often a probe answer is right for a customer: customers reach the probe only where the provider measured nothing and are mostly not cited, and there the same probe's yes is right far less often.

**Design**

- Panel: 80 public brand domains chosen by the operator under the owner's criteria (no customer, no customer's competitor), about half expected to be cited, plus a reserve list of 20 fixed before the first call. Two non-branded prompts each, produced by the same generator and defaults the live path uses. Branded prompts are excluded. Only engines with a valid truth take part. After run 1, and before any probe answer is compared with truth, the cited share per engine is computed; if it is outside 0.30 to 0.70, reserve domains are added.
- Why 80: the sample size is the number of domains, not the number of items. In simulation a probe with sensitivity and specificity of 0.65 was detected in about 56% of studies at 40 domains and about 92% at 80. Doubling prompts per domain helps far less than doubling domains.
- Sample: one call per item per engine with the live model and prompt text, scored with the matcher the live path uses on the day of the run. If a stricter matcher is preferred (whole-word, an operator alias list, dictionary-word brands matched on domain only), it ships to the live probe before the first call, so the study tests what customers get. The engine-level values customers see are reported from the panel, not tested.
- Truth: one provider measurement per item, by the method CL3a-1 validates, scored by the same matcher. The panel is run twice, a week apart.
- Test, registered before the first call, one per engine: a one-sided whole-domain permutation test of association between probe answer and truth, both runs together. Statistic: the sum over the engine's items of (probe answer minus the mean probe answer in that run) times (truth minus the mean truth in that run). Reference: 10,000 permutations that give each domain's whole block of truths to another domain's block of probe answers; seed 20261003. Engines are tested separately with Holm's correction, familywise one-sided 0.025.
- Reported with 95% whole-domain intervals, not tested: sensitivity, specificity and their sum minus one (J); the share of probe yes and probe no answers that were right; run-to-run agreement of truth and of probe; and the leave-one-domain-out Brier difference against a base rate, with predictions computed once on the full panel and frozen before whole domains are resampled.
- Consequences, registered before the first call, per engine. **Keep:** Holm-adjusted p at or below 0.025, meaning probe yes answers were cited more often than probe no answers on this panel; that engine keeps the `estimated` path, and section 8 may be reopened for it. **Stop:** anything else; the router returns `not_measured` for that engine and its hosted probe spend stops. A Stop is recorded as "shown weak" if the 95% interval for J lies below 0.20, otherwise "not shown". The one extension the owner may grant is a third run of the same panel a week later, analysed with all runs together; if it is used after seeing a result, each look is tested at 0.0125. A Stop is applied to the router in the PR that records the result and removes the route.
- The two runs share domains, so they guard against run-to-run noise only, not against an unlucky panel.

| ID | Task | Files | Acceptance |
|---|---|---|---|
| CL3a-0 | Admin study route, `POST /admin/calibration/study`: rate limit, then `isAdminAuthorized`, then dispatch. **Dark by default:** the ceiling is the `amount_cents` of a `budget_policies` row for account `system:calibration` with a lifetime window, created by the operator only after owner decision 1; with no such row the route returns 503 `STUDY_DISABLED` before reading the body. The ceiling is compared with the all-time total for that account, not a calendar month, so two runs a week apart cannot spend it twice. Spend is reserved before any provider call with one statement that inserts a `cost_events` row only if the total plus the reservation stays at or under the ceiling; the reservation uses rate-card constants in code, an explicit provider, tool name `calibration_study`, and is rounded up to a whole cent. Body through `readBody` with the small cap: at most 10 items per call, each domain through `safePublicHostname`, prompt at most 300 printable characters, engine from a closed list; nothing in the body sets a price, a ceiling or a model. Matching runs in the Worker; the response carries per item only `sampleCited`, `truthCited`, `truthTimestamp`, `costTenths` and an error code, never answer text. Each call writes an audit row. Keys stay in Worker secrets. The route is removed in the PR that records the result. | `worker/index.ts`, `worker/adminAuth.ts`, new `worker/calibrationStudy.ts`, tests | Missing or wrong secret: 401; secret unset: 503; no budget row: 503 before the body is read. At the ceiling the batch does not start. A batch that throws after the provider call still leaves its reservation. Two concurrent calls at ceiling minus one reservation start exactly one batch. An answer containing a marker string never appears in the response or a log. `upsertAppUser` rejects any id starting `system:`. |
| CL3a-1 | Truth validity, run first. Establish a measurement that can return a real negative. Per engine, hand-check 60 provider-positive and 60 provider-negative non-branded items drawn from the panel's frame, each in two separate clean sessions, by a named person who did not write this plan. Record which engines the provider covers and whether an answer's timestamp falls in the week measured. | this document | Pass, per engine: at least 57 of the 60 positives are positive by hand and at least 57 of the 60 negatives are negative by hand (these are predictive values; Wilson lower bound 0.863). The unit is the item: it counts as confirmed only if both sessions agree with the provider; items whose sessions disagree are listed and count as not confirmed. Sensitivity and specificity are derived from the two predictive values and the provider-positive share of the frame, reported, and must each be at least 0.85. Provider test-retest within 24 hours: the same label on at least 114 of 120 items. Checker consistency is measured separately by re-judging 30 saved answers blind. An engine that fails leaves the study, is recorded as "truth not valid", and its `estimated` path is unchanged by this study. If none pass, the study stops and the finding goes to WDL2. |
| CL3a-2 | Run the panel twice, a week apart. Analysis script with the registered permutation test and the seeded whole-domain resampler. | new `evals/calibration-study/` | On a synthetic fixture with a pure-noise probe the test rejects at or below the nominal rate; with a probe at sensitivity and specificity 0.75 it rejects. The report states, per engine, the adjusted p, the reported intervals, and which registered consequence applies. |

**Order:** CL3a-0, then CL3a-1 (its provider calls use the route), then CL3a-2 for the engines that passed.

**Phase 3a double-check:** the reservation race test; no answer text in any response or log; the script's test, seed and consequences match this section before the first call.

**Start when** owner decision 1 is yes and its conditions are met. **Ends** with the result recorded in section 13, whichever way it falls.

---

## 8. Parked, with the conditions to reopen

Nothing in this section is scheduled. It records what review found, so the work is not repeated and the same mistakes are not made if it is reopened.

**Reopen only when all hold:** CL3a recorded Keep for at least one engine; the live path computes at least 3 independent samples per engine for a customer request (an owner decision, since it raises cost per request); WDL2 Live answer capture is in production; and at least 5 distinct accounts called the visibility tool in the previous 30 days.

**Binding rules if reopened (from review rounds 1 and 2):**

1. Weights are learned and tested only over the samples the live path actually computes, in the configuration it computes them. A baseline is never a pool member.
2. The paper divides each regret by the spread of the regrets, which makes the weights collapse toward one source from sampling noise, and its `e = 0.01` does not stop that: two simulations put the top share among three equally good sources between 0.68 and 0.88, against 0.33 for equal weights. Replace `e` with the standard deviation of the difference in log epoch Brier loss between two repeat runs of one source, minimum 0.1. Register one parameter version (p, c, the averaging constant, e) before the first epoch, and only after a simulation with equal sources shows a mean top share under 0.45.
3. Item loss is Brier. For weights only, epoch loss is smoothed as `(sum of item losses + 0.25) / (n + 1)`, with every source scored on the same items; gate comparisons use unsmoothed means. Reference loss and the spread are per engine. A new source has zero weight for its first 4 graded epochs. Weights are computed in log space, with population spread and natural logs.
4. The gate resamples whole domains, uses weights learned on other domains and earlier epochs only, runs once at epoch 12, and needs at least 30 domains; its size is set by a registered power calculation in domains, not by a count of outcomes. An item-level resample with weights learned on the same items gave a false pass rate over 50% in simulation.
5. The combination, the equal-weight average and the base rate are scored after the same leave-one-domain-out calibration. The combination must beat both, each one-sided at 0.025 by whole-domain test. If it beats equal weights but not the base rate, the result is "not shown to carry information" and nothing is served. If it beats the base rate but not equal weights, the learned weights are dropped.
6. The 95% whole-domain interval for the combination minus a regularised stacking comparator must lie below +0.01 Brier, a margin fixed before the first epoch. If the interval spans the margin the result is "not resolved" and nothing is served.
7. Attribution is computed at equal weights. One-in means adding the source to the constant lowers loss, not that the source beats the constant alone.
8. Serving makes no provider call beyond those the live path already makes for the request. A sample is a rate over at least 5 prompts; with yes-or-no samples, or fewer than 3 samples, no range is shown. A range is the literal lowest and highest sample. The words agreement, confidence, high, medium and low are not used.
9. Approved copy if a range is ever served: "Estimated from {n} samples: {names}. Lowest {lo}%, highest {hi}%. Not a measurement, and not a range the true value must fall in."
10. Panel spend is reserved before the call, belongs to the budget plan's scheduled-surfaces rollout, and has a cap the owner can change without a redeploy.
11. A track record of server re-checks per rule is an operator query over distinct (account, domain) pairs, shown to nobody until at least 30 cases from 20 accounts exist, and never used to order the weekly action.

---

## 9. Cross-plan ownership and edits

| Topic | Owner | Edit to make (in CL0-2) |
|---|---|---|
| Findings row id and `/findings/bulk` | This plan's CL0-1, which lands before verifiable-flow V1 touches the route | Verifiable-flow section 10: "Allora CL0-1 lands before V1 touches `/findings/bulk`." |
| Shape of the rule id | Verifiable-flow V2-3: `evidence_json.provenance.ruleId` | Verifiable-flow V2-3: "`ruleId` is already set by Allora CL0-5, which also adds `targetUrls` under `provenance`. This task adds evidence ids only." |
| Study spend | Budget plan | Budget plan P2 line: "The one-off study (account `system:calibration`) is a paid surface outside MCP. Its ceiling is a `budget_policies` row. `recordCostEvent` rounds up and requires a provider." |
| Dashboard seeding from the server | Shared by CL2-0 and verifiable-flow V2-9; the first to land owns `DashboardView` seeding | Both plans name the other task |
| Fetch wrapper | This plan's CL0-3 | Zoro P1-3: "Reuse `worker/publicFetch.ts` from Allora CL0-3. This task keeps V0 only." |
| Retest | WDL plan | WDL6 row: "WDL6a page-source retest (was the issue still there): Allora CL1-CL2. WDL6b same-prompt retest: open, depends on WDL2." |
| One-sided measured visibility | WDL2 and go-live G1 | WDL2 row: "The measured path must be able to return not cited. No rate from domain-filtered rows." |
| Migration and spec numbers | Assigned at PR time | None; both same-day plans refer to migrations by name |
| Status vocabulary | Ruled together with Zoro decision 8 | Owner decision 3 |
| Daily cron job list | Shared: this plan's CL2-1 and verifiable-flow V2-10 each add a job and edit the same four test assertions | The second to land rebases the assertions; both plans name the other task |
| Moving `audit_findings` on account link | Verifiable-flow V2-1b's helper and collision rule | CL1-1 calls that helper, or creates it with the same rule if it lands first |
| Worker-fetched evidence | Verifiable-flow V2-0 | None; this plan writes no `audit_evidence` rows |
| Server-side rules | Verifiable-flow V6 if approved | V6 reuses `services/audit/ruleDefinitions.ts` and `worker/decisionChecks/checks.ts` |

Recommended, not owned here:

- Add a `concurrency` group to both deploy jobs so a late run cannot redeploy an old flag value.
- Remove the hard-coded "Conf: {n}%" line at `components/audit/EmpiricalEvidenceDrawer.tsx:204`, which Zoro lists as a known over-claim. Owner: Zoro P1-10. If P1-10 is still blocked when Phase 1 here starts, ship the one-line removal as its own PR.

The edits to the four companion plans (verifiable-flow, budget, Zoro, weekly decision loop) ship as one separate docs PR, because another session is working in those files.

Suggested order across plans, for the owner to confirm: CL0-1 and CL0-0 now (CL0-1 reaches production only after CL0-0 records the promotion path); then CL0-3, CL0-4 and CL0-5; then verifiable-flow V0-1 (workspace data loss) and the open conversion-honesty items; then CL0-2 and Phase 1; then Phase 2.

---

## 10. Dependency graph

```
CL0-1 (findings hotfix) --+
CL0-0 (facts, blocking) --+
CL0-3 (fetch wrapper) ----+--> Phase 1 (re-check at commit) --> Phase 2 (retest, durable card)
CL0-4 (flags, switch) ----+
CL0-5 (rule definitions) -+
CL0-2 (spec, cross-plan edits)  after the others

Phase 3a (study)   independent of Phases 1-2; waits on owner decision 1, which takes CL0-0's account count as input
Section 8 (parked) waits on Phase 3a and its reopen conditions
```

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Findings never reach D1, so no check can be created | CL0-1 ships first, alone |
| A client forges a result | The client names a rule and, through findings sync, the URLs; the server picks the check and measures. URLs are bounded by 3.3 |
| The check runner becomes an open fetcher | Target host must equal the normalised domain or its `www` twin; domain allowance by plan; atomic per-decision, per-account, per-day and per-site caps; route rate limit; off-domain redirects refused |
| SSRF | Per-hop validation, default port only, own hosts refused, extra IPv6 ranges, one deadline. The resolve-twice gap is an accepted residual because no response bytes are returned |
| Fetched text reaches a user, a log or a model | Results are closed-list codes; marker-string tests on the check result (CL1-2), the row, responses and logs (CL1-4) and the MCP result (CL2-6) |
| Most decisions have no check, so the feature looks empty | Checks follow the action as well as the finding; coverage is measured fourteen days after the production flag and reported to the owner under half, before Phase 2 promotes (CL1-0) |
| The chip contradicts the card title | The check name is always shown |
| A returning user never sees the result | CL2-0, and the fresh-profile promotion criterion |
| "Cleared" read as "AI answers improved" | Approved strings and the fixed caveat in 3.5 |
| Server and browser disagree for method reasons | One shared rule module; neutral wording; an issue the server cannot find gets no retest |
| A stuck page retried forever | Attempt counter rises in the claim; 3 attempts; expiry |
| Overlapping runs double-grade | Lease in the claim; fenced result write; overlap test |
| A Free account is locked out by open rows | Open rows expire and stop counting |
| A lapsed plan loses a retest it paid for | Entitlement fixed at commit |
| Flag-off behaviour changes for existing users | Characterisation test written first (CL1-3) |
| A problem needs stopping faster than a deploy | KV off-switch |
| Rollback turns a flag back on | Rule 2.2; the KV switch still applies |
| A migration auto-applies with no backup | Back up and record the bookmark before merging |
| Rows orphaned by account linking | Link moves the three tables (2.3) |
| Phase 3a spends with no ceiling | Reserve-before-spend against an owner-approved ceiling; keys never leave Worker secrets |
| The study passes on noise, or keeps a probe that is wrong | One-sided whole-domain permutation test per engine with registered consequences. The two runs share domains, so they guard against run-to-run noise only, not an unlucky panel |
| The study is too small to detect a useful probe | 80 domains with a reserve and a prevalence check; power stated in section 7 |
| The study's result is read as "how often the probe is right for customers" | The scope paragraph at the top of section 7 |
| Scope returns through the back door | Section 8 is a record, with explicit reopen conditions |
| Two same-day plans collide | Section 9 |
| Licence keys stop redeeming | Rule 2.5 and Zoro 2.8 |

---

## 12. Owner decisions needed

| # | Decision | Blocks | Default if no answer |
|---|---|---|---|
| 1 | Run the Phase 3a study. It runs in production through the admin route, because staging has no keys. Size, per engine with a valid truth: about 640 provider calls for the panel, about 240 for the truth check, and about 240 manual checks by a named person who did not write this plan (so up to about 2,600 paid calls, probe and provider together, and 720 manual checks if three engines qualify). The ceiling is a `budget_policies` row for `system:calibration`; with no row the study cannot run. If CL0-0 counts zero accounts calling the visibility tool, run CL3a-1 only. A yes also approves the consequence in section 7: on a Stop for an engine the router returns `not_measured` for that engine and its hosted probe spend on customer calls stops. At most one extension, as defined in section 7. | Phase 3a | Not started |
| 2 | Packaging in section 6: Free gets the chip and manual retest on 1 domain; automatic retest from Starter | CL1-4, CL2-2 | As written |
| 3 | Approve the strings in 3.5 and the CL2-7 messages, ruled together with Zoro decision 8 so the product has one status vocabulary | CL1-5, CL2-4, CL2-7 | As written |
| 4 | Telegram notice policy: at most one message per decision to the account's own chat, the result for automatic retests or a reminder at the verify date for manual ones. Without it, only users who come back unprompted see a result. | CL2-7 | No messages |
| 5 | Privacy page sentence and the 180-day retention. Draft: "When you commit a weekly action, Luminara stores the page addresses it checked and may fetch those pages again at or after your verify date. These records are deleted 180 days after the result." | CL1-1; turning the Phase 1 flag on in production | The flag stays off in production until the sentence is published |
| 6 | Order of this plan against verifiable-flow and the open conversion-honesty items (section 9) | Scheduling | The order in section 9 |

---

## 13. Review record

| Round | Reviewers | Verdict | Outcome |
|---|---|---|---|
| 0 | Three read-only codebase surveys (data layer, scoring and AI pipeline, frontend and release) | Input | v1.0 |
| 1 | Full-stack, AI/ML, security and release, CEO, each on v1.0 | No-go from all four: 20 blockers, 53 majors, 28 minors | Rewritten as v2.0 |
| 2 | Closing check on v2.0 by the same full-stack, security and CEO reviewers against their own findings, plus a fresh AI/ML reviewer on sections 0, 7 and 8 | Of 78 round-1 findings re-checked: 54 fixed, 18 partial, 6 ruled otherwise and accepted. New: 3 blockers, 17 majors, 22 minors. Phase 0 go; Phases 1-2 conditional go; Phase 3a no-go as written | All applied in v2.1. The revised SQL was re-run against the real migrations |
| 3 | One fresh reader on v2.1, for internal consistency only | 25 inconsistencies left by the edit passes; no design change | All applied in v2.2; the cap SQL was re-run with the expiry condition |

Per-phase verdicts after round 2, with the conditions that are not text changes:

| Phase | Verdict | Open condition |
|---|---|---|
| 0 | Go. CL0-1 can start at once | No production step before CL0-0 records the promotion path |
| 1 | Conditional go | CL0-0 confirms a paid Workers plan; owner decisions 2, 3 and 5 |
| 2 | Conditional go | Phase 1 in production; the coverage report read; owner decision 4 recommended |
| 3a | No-go as written in round 2; redesigned in v2.1; owner-gated | Owner decision 1, with the ceiling and the hand-checker named |

Round 1 findings and where they landed:

| Finding | Fix |
|---|---|
| A returning user could never see the before/after | CL2-0; fresh-profile promotion criterion |
| "Completes WDL6" was false; only page source is retested | Retitled as WDL6a; non-goal in 0.3; section 9 edit |
| "Confirmed" chip created a parallel vocabulary and covered Sample rows | Approved strings in 3.5; rule rows in the finding box, action rows under the title |
| Effective-count line was a new derived number on a 3-query sample | Cut (0.2 row 7) |
| Range, agreement label and source counts would misstate what was computed | Nothing served; copy rules in section 8 |
| The live path has one sample per engine, so there was nothing to combine | Concepts 2-5 parked; reopen conditions in section 8 |
| The promotion gate resampled items, not domains, and passed on noise | Section 8 rules 4-5; Phase 3a resamples domains |
| Ten panel domains could not pass an honest gate | 80 in Phase 3a; 30 minimum and a registered power calculation in section 8 |
| The paper's default constant gave winner-take-most on noise | Section 8 rule 2 |
| A 40-item truth check was too weak and hid specificity | CL3a-1: 60 and 60, each class judged separately |
| The gate could pass when probes were pure noise | Section 8 rule 5; Phase 3a's registered permutation test, with the base-rate comparison reported |
| Phase 3 was a weekly system built to answer a one-off question | Replaced by the Phase 3a study |
| The server could not obtain target URLs; two rules are site-level | 3.1, 3.2, CL0-5 |
| Phase 1 created pending rows only a Phase 2 job could resolve | No pending state (3.4) |
| The validator and Oracle wiring in the serve task did not exist | Serve task removed; recorded in 1.1 |
| The claim statement broke "one row per domain" and could starve | Tested statement in 3.6 |
| The table did not support the lifecycle or the caps | 3.7 rewritten: host, manual retest, expiry, table checks, indexes |
| The decision domain was raw user input; caps did not bound fetch volume | 3.3 |
| The route had no context, limiter or body cap | CL1-4 |
| The findings fix was incomplete | CL0-1 expanded |
| The check followed the finding while the title followed the action | Checks follow both; the check name is shown |
| `verify_by` moved on every re-post and was client-controlled | `due_at` fixed once and clamped (3.4) |
| Flag validation would break an existing test | CL0-4 |
| Entitlement at job time needed an identity the job lacks | Entitlement fixed at commit (3.4) |
| Manual retest could not be limited per decision | D1 claim on `manual_retest_at` (CL2-3) |
| Fetch deadline did not cover DNS; any port and own hosts were allowed | 3.8, CL0-3 |
| Detail fields could carry fetched text | Closed-list codes; marker test |
| A new cron plus a rollback would run Sentinel 96 times a day | No new cron; rule in 2.2 |
| The only kill switch needed a full deploy | KV off-switch (2.1) |
| Privacy rule left orphans and missed `audit_findings` | 2.3, CL1-1 |
| Promotion steps were not executable; staging is behind main | 2.2; CL0-0 records the enforced path |
| Health exposed counts and would add a query; smoke would fail a first deploy | CL0-4, CL2-5 |
| Workers limits were treated as a batch-size detail | CL0-0 blocks Phase 1 |
| No observability or runbook | CL2-5 |
| Packaging by tier was unstated | Section 6 table; owner decision 2 |
| Nothing told the user a retest was graded | CL2-7; owner decision 4 |
| Math library and extra flags were speculative groundwork | Removed from Phase 0 |
| A second same-day plan claimed the same numbers and overlapped | Section 9 |
| Section 2 restated Zoro and had drifted | Section 2 is deltas only |
| Study spend had no ceiling and keys would leave the Worker | CL3a-0 |
| Track record per rule was client-steerable and unreachable | Section 8 rule 11 |

Round 2 findings and where they landed:

| Finding | Fix |
|---|---|
| An action-triggered check said "same issue found" inside a box showing a different finding | Separate strings and placement for action rows (3.5) |
| A manual retest could report an issue as gone that the server never saw | `cleared` and `still_present` require a failed baseline (3.4) |
| A row could be open with no real baseline if a request died after the insert | Rows start graded `not_measured` with code `not_run`; the claim requires a failed baseline (3.4, 3.6) |
| The account-link move left a check pointing at a deleted decision, and a repeat link deleted everything | Ordered steps and four tests (2.3, CL1-1); re-run on SQLite |
| Two expiry rules; missing strings for open, expired and refused states | One rule at `expires_at` (2.1); strings added (3.5) |
| The off-switch failed open and its value was easy to set backwards | Fails closed; value names what is disabled; separate key from the run stamp (2.1, 3.6) |
| The rate limiter could fail the save with a 5xx | The limiter and the switch never block the save (3.3) |
| The domain allowance was not atomic; "a fetch" and the backoff were undefined | All caps inside one insert; per-site cap and backoff defined on stored columns (3.3) |
| The claim had no attempt ceiling; the job could overwrite a manual grade | Ceiling in the claim, exhausted rows graded, state guard on the write (3.6) |
| The retest shared one invocation's subrequest budget with Sentinel | Retest runs first and is awaited; Sentinel never blocked (3.6) |
| The durable read could not find a decision posted as a URL, or any decision in a fresh profile | `latest=1` lookup through `decision_checks`; the card loads it itself (CL2-0) |
| The shared rule module would have dropped thin-content findings in the browser | Browser imports only the type list and threshold; new fixture (CL0-5) |
| The flag test would fail the PR that turns a flag on for staging | Asserts declared and boolean, top level equal to production (CL0-4) |
| Resolving a legacy `finding_id` by stable key cannot work | Resolution order moved to CL1-4; clause removed from CL0-1 |
| The study route was live once merged; a monthly ceiling could be spent twice | Dark until a lifetime budget row exists; all-time ceiling; validated inputs; no answer text returned (CL3a-0) |
| The study's test had almost no power, was blind to direction, and pooled three engines | One-sided whole-domain permutation test per engine with Holm's correction (section 7) |
| Forty domains were too few; the panel could come out lopsided | 80 domains, a reserve of 20, a prevalence check |
| The study did not test what customers get, and its result could be over-read | Live matcher rule; scope paragraph |
| The truth check named the wrong quantities and the wrong unit | Predictive values per engine; the item is the unit (CL3a-1) |
| Several parked rules were misstated (a 0.002 margin the gate cannot resolve, a count of outcomes instead of domains, a null result asserted as fact) | Section 8 rules 2 to 9 rewritten |
| The companion plan changed during review (cron job list, link helper, worker-fetched evidence) | Three rows added to section 9; this plan writes no `audit_evidence` rows |
| Privacy sentence, pricing copy and route docs had no owning task | CL1-1, CL2-8, `worker/README.md` in CL2-0 and CL2-3 |

Round 3 findings, in groups, and where they landed:

| Finding | Fix |
|---|---|
| Result and refusal codes were named in three places and listed in none | Both closed lists, their strings and the manual-retest refusals in 3.7 |
| A manual re-baseline could not be written under the `not_run` guard; a manual not-measured run was invisible to the caps | Guard and recorded fields in 3.4 |
| Open rows could count against the cap forever before the retest job exists, or with it off | Expired open rows do not count (3.3 rule 4); the job grades and purges even when off (2.1) |
| The manual-only reminder had no step that could send it | Separate stamped step in 3.6; CL2-7 |
| Phase 1 acceptance required Phase 2 strings; re-post rules contradicted each other; URL length had three values | CL1-5, 3.3 rules 2 and 7, 2.3 |
| Phases 1, 2 and 3a had no order line; a promotion criterion could not be checked | Order lines added; Phase 1 criteria rewritten |
| The study's extension, a failed engine and applying a Stop were undefined | Section 7, CL3a-1 |
| Stale wording: three link tests, one chip, a caveat that did not fit a still-found result, a migration number another session has since taken | Corrected where they stood |

Reviewer disagreements and how they were ruled:

| Question | Ruling | Why |
|---|---|---|
| Entitlement at job time, or fixed at commit | Fixed at commit | Plans last 30 days and the verify window is 14, so a job-time check drops what was sold; it also removes a KV read the job has no identity for |
| Reuse the crawler-file fetcher unchanged, or route it through the new wrapper | Neither: those checks are out of this version | No finding or action triggers them, and the fetcher is shared with the landing Probe |
| A public-suffix list for subdomains | Not needed | Only the exact domain and its `www` twin are checked |
| A 15-minute cron, split across two releases, or the daily cron | Daily cron | Volume is tiny and it removes the rollback hazard |
| Study as a local script, or keys kept in the Worker | One admin route; analysis script local | Keys stay in secrets and spend is capped server-side |
| Study ceiling as a budget row, or as a deploy-time var that defaults to off | A lifetime `budget_policies` row; no row means disabled | Dark by default, changeable without a deploy, and one budget system |
| Expire rows 7 days past due, or only at `expires_at` | Only at `expires_at` | A second rule would silently drop a retest a paid plan was sold |
| Promotion path as an owner decision, or as a fact | A fact recorded in CL0-0; no production step before it | The answer is in the repository settings |
| Rule-triggered chips in the finding box, or in a block under the title | In the finding box; under the title when no box is rendered | Keeps the result next to the finding it is about |
