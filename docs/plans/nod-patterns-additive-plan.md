# Track ND: Nod patterns, additive plan

Status: v3, approved by the owner 2026-11-14 with the recommended answers to decisions 1 to 3. Being built as draft PRs.
Base: `origin/staging` at `1023d32c`. Every citation is to that commit unless it says PR340 (`origin/feat/agentic-oracle` at `9a2b2700`, draft PR #340). Re-confirm the staging tip before starting; local checkouts have been found far behind it.
Reference: `n8n-io/nod` at `e697ec3` (Apache 2.0). Patterns only. No Nod code is copied.
Rules: this plan inherits section 2 of `docs/plans/zoro-concepts-implementation-plan.md` (gates, flags, release, rollback, migrations, privacy, double-check) and does not restate them.

## What the owner does

Read this page. The rest is for whoever builds it.

**What this plan is.** Four small fixes to things that are wrong today, and one test suite that checks the audit still finds what it should. That is what survived two rounds of review.

**What happened to the three things you picked:**

| You picked | In this plan | Why |
|---|---|---|
| One gate for every action | Deferred (section 6) | The agentic Oracle in draft PR #340 already puts an approval card on every outside action. Until the agent has more than one such tool, a bigger gate protects nothing new |
| Outcome evals | Built small: six test sites (ND1) | The repo can run them for free on every change. A bigger suite needs a model budget |
| Watch and speak only on change | One fix (ND0-2) and a proposed change to Track SW (section 4) | Track SW already designs the notice system. A second one would compete with it |

**What it is not.** It is not 10x and it does not bring users. Section 0.1 answers that question straight.

**What ships, in this order:**

| Item | What a user sees | Trade-off you are accepting | Size (estimate) |
|---|---|---|---|
| ND0-1 | The weekly Telegram briefing arrives once a week, not every day. Linked accounts that never got it start getting it | If the server dies in the instant between marking and sending, that one briefing is lost. Better than seven copies | Half a day |
| ND0-3 | The fix panel stops saying a backup snapshot was taken when none was | Needs decision 2 | Half a day |
| ND0-2 | A site with a lasting problem is re-audited weekly instead of daily. Its audit data refreshes weekly while nothing changes | Needs decision 1 | Half a day |
| ND0-4 | A page whose schema markup is broken is told it is broken, not that it has none. No score changes | none | One day |
| ND1 | Nothing visible. Six test sites with planted faults run on every change | You confirm six plain-English rows, about 10 minutes (ND1-3) | Two days |

The ND0-1 database change rides the next normal staging-to-main release. None of this needs to finish before the 19 November checkpoint, and none of it should displace growth work.

**How to approve.** Reply "go" with your answers to the decisions. Each item is then opened as its own draft PR. Nothing merges until you mark it ready.

**Decisions needed from you** (detail in section 5):

| # | Question | Recommended | If you say nothing |
|---|---|---|---|
| 1 | While a site's problem stays the same, re-audit it at most once every 7 days? | Yes | ND0-2 waits; daily re-audits continue |
| 2 | Respira fixes: stop claiming a snapshot, or block those fixes until snapshots exist? | Stop claiming | ND0-3 waits; the false claim stays on screen |
| 3 | May I propose a short change to Track SW so its notices tell a user once per problem, not once per day? | Yes | Track SW is left as written |

**One thing to know that is not part of this plan.** The table that stores approval requests (`mcp_action_requests`, which holds tool arguments) is missing from both the data export and the account erase on staging. Open PR #308 adds it, but that PR is marked as conflicting and cannot merge as it stands. It needs a rebase. That is a privacy fix and should not wait on anything here.

**Words used below:**

- **Scenario**: one fake website, kept as a file, with faults put in on purpose and a list of what the audit should say about it.
- **Fingerprint**: a short code computed from a scenario's contents. If anyone edits the scenario, the code changes and the edit cannot go unnoticed.
- **Gate**: the list of scenarios that must pass before a change can merge.
- **Gap scenario**: a scenario where you and the product disagree about the right answer. It is reported and does not block a merge, except that inventing a fault or hiding a failed check always blocks.

## 0. Verdict

### 0.1 A straight answer to "10x" and "survive the LLMs"

Nod's lesson is that the model is replaceable and everything of value sits around it. For Luminara the things a chat model cannot give a user by itself are:

- a measured history of how a site's visibility moved,
- fixes applied to the user's real site with permission and a record,
- proof that the audit and the fixes are right.

This plan adds to the third only. It makes the product more trustworthy and easier to defend. It does not multiply anything.

What moves the user number is distribution and the first-value loop: the growth plan, the weekly decision loop (`docs/plans/weekly-decision-loop-10x-ship.md`) and own-brand agent distribution (Track AE). What makes the agent do the work is Track SW and the agentic Oracle (PR #340).

### 0.2 What review changed

| First draft | Now | Why |
|---|---|---|
| ND3: a new notification ledger with quiet hours | Cut. One proposed amendment to Track SW (section 4) | Track SW section 6.5 and decision 20 already design `notify_prefs` and `notify_sends`. Quiet hours cannot work on one daily cron |
| ND2: outcome record on approvals, server-bound chat gate, deploy record, actions list | Deferred (section 6) | One external agent tool exists. The chat gate change is a product change. The design had three holes |
| ND1 with 12 scenarios, its own runner and CLI | 6 scenarios inside the existing test run | The repo has no TypeScript runner outside Vitest |
| 7-day staging soaks | Removed | Staging has almost no traffic, so they would pass with the feature broken |
| Broken schema as a new health check | An informational finding only | A fifth health check would change every site's score text and break six existing assertions |

### 0.3 Phases

| Phase | Ships | Flag | Migration |
|---|---|---|---|
| ND0 | Four fixes, four separate draft PRs | none | `weekly_decision_sent` (ND0-1 only) |
| ND1 | Outcome evals inside `npm test` | none | none |

No flag: ND0 corrects behaviour and ND1 is tests. Rollback is `git revert` per the Zoro plan section 2.4.

## 1. Baseline

### 1.1 Verified by reading the code

Two verifier rounds re-read every line cited here.

- **Weekly digest.** `sendWeeklyDecisionDigest` selects this ISO week's `weekly_decisions` rows and sends one Telegram message per row (`worker/weeklyDecisionService.ts:383-395`, send at `:430`). It keeps no sent record, is called on every daily fire (`worker/index.ts:2671`) and is not in the Monday-only list (`worker/scheduledJobs.ts:60`).
- **Digest join.** It joins `wd.account_id = u.id` (`:393`). `weekly_decisions.account_id` holds the billing id, which is `users.account_id` and falls back to `users.id` only for a row with no account id (`worker/workerUtils.ts:125`). For a linked account whose canonical row is the Firebase one, the join never matches the Telegram row, so that user gets no briefing.
- **`weekly_decisions`.** Primary key `id TEXT`, with `UNIQUE (account_id, domain, week_key)` (`migrations/0014_weekly_decision_loop.sql`). The only writers are an `UPDATE` (`worker/weeklyDecisionService.ts:106-122`) and an `INSERT` (`:144`); neither replaces a row. Export and erase already cover the table (`worker/privacyService.ts:70`, `:406`).
- **Sentinel.** While a target needs an alert, a full audit is enqueued on every daily scan (`worker/sentinel.ts:262-270`). `enqueueAuditJob` has no dedupe and returns null when its bindings are missing. A trust regression and a competitor change each last one scan, because the values they compare against are overwritten every scan (`:206-209`, `:275`). `cited` defaults to true when the search provider has no key, fails or throws (`:159-183`), so a failed measurement looks healthy. `reaudit_due` overwrites `drift_detected` in `lastStatus` (`:255`).
- **Snapshot claim.** No code creates a snapshot. The panel sends `userConfirmed: true` and `snapshotCreated: true` as constants (`components/audit/CmsMcpRemediationPanel.tsx:100-115`); its fallback preview repeats the claim (`:133`). The relay refuses only when `snapshotCreated === false` for `respira_mcp` (`worker/cmsMcpRelay.ts:127`), reports `snapshot_before_write` true regardless (`:140`) and copies that flag into the envelope parameters for every non-Wix connector (`:329`). The MCP tool defaults an absent value to true (`worker/mcpConversionTools.ts:348`).
- **Broken JSON-LD.** `collectJsonLd` drops a block that fails to parse (`services/scraping/contentDistiller.ts:85-90`). The distilled result reaches the audit through `toCrewPage` (`services/agentCore/agents/scoutAgent.ts:25-48`, not exported) as `ScrapedPageEvidence` (`services/agentCore/types.ts:99`). The playbook auditor decides schema findings from `page.schemasFound` (`services/agentCore/agents/playbookAuditorAgent.ts:110`, `:121`, `:140`, `:154`).
- **Health checks.** `HEALTH_CHECKS` (`services/agentCore/auditEvidenceGate.ts:77`) lists four finding ids. Its length appears in user-facing text ("4 of 4 checks passed") and `STEP_FOR_FAILED_CHECK` (`services/agentCore/agents/executiveTranslatorAgent.ts:40`) is keyed on the same ids.
- **Evals today.** `npm run evals` replays 7 recorded responses through pure validators. No model. CI runs it as a failing step (`.github/workflows/ci.yml:56`). CI runs tests through `npm run test:coverage` (`:54`), which includes `tests/**/*.test.ts`. CI has no model or provider key.
- **Testable audit code.** These take an injected fetcher or are pure: `loadCrawlerSnapshot` (`worker/llmCrawlerRoute.ts:126`), `evaluateLlmCrawlerReadiness` (`services/audit/llmCrawlerReadiness.ts:306`), `crawlerFixes` (`services/audit/crawlerFixes.ts:19`), `summarizeProbeCrawl` (`worker/probeCrawlRoute.ts:147`), `contentDistiller.distill` (`services/scraping/contentDistiller.ts:121`) and `PlaybookAuditorAgent.execute` (`services/agentCore/agents/playbookAuditorAgent.ts:46`), which already runs offline in `tests/auditHonesty.test.ts`.
- **Confirmed behaviour the scenarios rely on.** A `robots.txt` that returns 503 yields `not_measured` for `ai_bot_directives` and `cite_paths` (`services/audit/llmCrawlerReadiness.ts:253-262`). An HTML or JSON body at `/llms.txt` is treated as missing, so `llms_txt` is `fail`.
- **Test helpers.** `tests/helpers/sqliteD1.ts` applies the real migration files and reports changed-row counts. `tests/auditFileDetection.test.ts:19-40` builds a fake site, tied to one host and four paths.

### 1.2 Not verified (each is resolved by a named task)

| Unknown | Resolved by |
|---|---|
| What `feat/visibility-unit-tests` already built that ND1 should reuse | ND1-0 |
| Whether a finding id outside `HEALTH_CHECKS` can move the health score | ND0-4, by test |

### 1.3 Open PRs and other plans

Each item is its own PR to `staging`, opened as a **draft** and marked ready only by the owner, because non-draft PRs are merged in waves.

| Item | Go or wait |
|---|---|
| ND0-1, ND0-3 | Go |
| ND0-2 | Go after decision 1. If Track SW has started, re-read `worker/sentinel.ts` first; SW1-12 edits `:225-249` and SW0-3 edits `:154-157` |
| ND0-4 | Go. PR #366 touches `services/audit/groundedCitations.ts`, not the distiller |
| ND1 | Go. It adds files and does not edit `evals/run-evals.mjs` (PR #366) or `ci.yml` (PR #376). `docs/plans/release-2026-11-12-audit-fixes.md` ships PR #350, which changed soft-404 handling; ND1 expectations are recorded after it |

## 2. Phase ND0: four fixes

### ND0-1 Weekly digest sends once

- Migration `weekly_decision_sent`: `ALTER TABLE weekly_decisions ADD COLUMN telegram_sent_at INTEGER;` Confirm with `migrations list` that it is unapplied first; `ADD COLUMN` is not idempotent. Add the file to `REQUIRED_D1_MIGRATIONS` in `scripts/smoke-check.mjs`. Verified: it applies cleanly to the replayed staging schema.
- Select only rows where `telegram_sent_at IS NULL`, with an `ORDER BY`.
- Fix the join: `JOIN users u ON COALESCE(u.account_id, u.id) = wd.account_id AND u.telegram_id IS NOT NULL`, which matches how the billing id is built.
- Claim before sending: `UPDATE weekly_decisions SET telegram_sent_at = ? WHERE id = ? AND telegram_sent_at IS NULL`. Send only if one row changed. If the send fails, set it back to `NULL`.
- No privacy change: the table is already exported and erased by account.

Acceptance, with `tests/helpers/sqliteD1.ts` and a stub sender, no sockets:

1. One decision row, two `scheduled()` runs in the same week: one message.
2. Two domains for one account: two messages, then none on the next run.
3. The sender fails once: no sent mark, and the next run sends it.
4. A linked account whose canonical row is not the Telegram row: one message to the Telegram id.

Known limit, noted not fixed: a user who blocked the bot fails every day and is retried every day. With `LIMIT 100`, a hundred such rows would starve the rest. That is not reachable at today's size.

### ND0-2 Sentinel re-audits on change, not daily

Needs decision 1.

- Add three fields to `SentinelTarget` (KV JSON, no migration): `lastDriftKey`, `driftSince` and `lastAuditEnqueuedAt`.
- The drift key holds lasting conditions only. Today that is one code, `not_cited`, set only when the search provider actually answered. A trust regression or a competitor change is a one-scan event and is not part of the key.
- Enqueue an audit when the target needs an alert and any of these holds: an event fired on this scan; the key differs from `lastDriftKey`; or at least 7 days less one hour have passed since `lastAuditEnqueuedAt`. The hour of slack is there because the cron can fire a few seconds early.
- Count a competitor change as an event only on a scan where the provider answered. Today a failed provider call leaves the search text empty, so every tracked competitor looks as if it lost presence (`worker/sentinel.ts:203-209`).
- Set `lastAuditEnqueuedAt` only when `enqueueAuditJob` returns a job. An unset value counts as due.
- Set `driftSince` to the scan time when the key goes from none to a value.
- Clear `lastDriftKey` and `driftSince` only on a scan where the provider answered and the site was cited. A failed measurement leaves them as they were.
- Accepted: a site that flips between cited and not cited on alternate days is audited on each return to not cited. Each is a real change.
- The Telegram alert and its 24-hour cap are not touched.

Acceptance, driven through `scheduled()` with simulated days:

1. Not cited for 8 daily scans: audits on day 1 and day 8 only.
2. Not cited, plus a trust regression on day 3: audits on day 1 and day 3, none on day 4.
3. Cited on day 4, not cited again on day 5: an audit on day 5.
4. Not cited on days 1 to 3 (audit on day 1), the search provider fails on day 4, not cited on day 5: no audit on day 4 or day 5. The target has tracked competitors, to prove a failed call raises no competitor event.
5. A healthy target: none.
6. The queue binding is missing: `lastAuditEnqueuedAt` stays unset, and the next scan tries again.

### ND0-3 Stop claiming a snapshot

Needs decision 2. Written for the recommended answer: stop claiming.

Six places, one PR:

1. `components/audit/CmsMcpRemediationPanel.tsx:115`: do not send `snapshotCreated`.
2. Same file, `:133`, and wherever the panel prints the envelope: when the flag is false, show "No backup snapshot is taken. Back up the page first."
3. `worker/cmsMcpRelay.ts:140`: report `snapshot_before_write` as `false` unless the caller sent `true`. The envelope at `:329` then carries `false` too.
4. `worker/mcpConversionTools.ts:348`: an absent value stays absent, not `true`.
5. `connectors/mcp/tool-catalog.json:664`: the schema text for the field says the caller sets it only when it took a snapshot.
6. `services/enquiries/enquiryApiClient.ts:324`: the field becomes optional.

Unchanged and accepted: the relay still refuses a caller that says `false` for Respira; a caller that says nothing proceeds, as today; a caller can still say `true` without proof. A cached duplicate response made before this change keeps its old `true` until it expires.

Acceptance: a relay test where the caller omits the field gets `snapshot_before_write: false` in both the report and the envelope and is allowed; an MCP tool test where the field is absent passes it on absent; a panel test asserts the request body has no `snapshotCreated` and the warning text is shown. `tests/cmsMcpAndDesktop.test.ts:144` and `:156` keep passing.

If decision 2 is "block instead": change only site 3 to refuse Respira when the field is absent, and say so in the panel. Respira fixes then stop working until a snapshot step is built.

### ND0-4 Broken schema is reported as broken

`HEALTH_CHECKS` is not changed. No site's score or "4 of 4" text changes.

- `distill` returns an optional `schemaParseFailures`: the number of `application/ld+json` blocks that failed to parse.
- `toCrewPage` copies it onto `ScrapedPageEvidence`, and is exported so ND1 can call it. Where `services/scraping/siteEvidencePack.ts:368` merges discovered schemas, keep the larger of the two counts.
- A page with a broken block and no working schema keeps `finding-schema-org`, with wording that says a schema block is present but cannot be read. Same id, same penalty.
- A page with a working schema and a broken block gets a new informational finding, `finding-schema-org-broken`, which is not a health check.
- The auditor's "covered" test is site-wide: any page with an Organization-type block counts. When one page is covered and another page's only block is broken, today's `finding-schema-org-partial` says that page has no tags. Its wording for that page changes to say a block is present but unreadable. Same id.
- Add the new id to the label maps in `services/audit/reportBlocks.ts:312-322` and make sure the critic's schema branch (`services/agentCore/criticReflectionEngine.ts:52-56`) does not drop it.

Acceptance:

1. Broken block only: `finding-schema-org` with the broken wording.
2. One good Organization-type block and one broken block on the same page: `finding-schema-org-broken`, and no `finding-schema-org`.
3. No schema: `finding-schema-org` with today's wording.
4. Page A has a good Organization block, page B has only a broken block: `finding-schema-org-partial` whose text for page B says the block is unreadable.
5. For fixture 2, the health score equals the score of the same page without the broken block. If it does not, the new finding is moved out of whatever sums it.
6. `finding-schema-org-broken` appears in the rendered report with its own label, after the critic has run.
7. `tests/auditHonesty.test.ts` and `tests/auditFileDetection.test.ts` pass unchanged.

## 3. Phase ND1: outcome evals

### 3.1 Design

A scenario is a TypeScript file under `evals/outcome/scenarios/` exporting:

- `id`, and `stance`: `regression` (must pass) or `gap`,
- `says`: one plain-English sentence per fault, stating what the product should tell the user. This is what the owner confirms,
- `site`: a map of path to `{ body, status, type, location }`,
- `expect`: exact check ids with statuses, fix ids and finding ids,
- `forbid`: ids that must not appear.

One Vitest file, `tests/outcomeEvals.test.ts`, loads every scenario, builds a fake fetcher, runs the real functions from section 1.1 (through the exported `toCrewPage` for pages) and scores:

- **found**: every expected id and status is present.
- **invented**: a forbidden id appears, or anything is reported on the clean site.
- **dishonest**: a fetch that failed is reported as `pass` or `fail` instead of `not_measured`.

`invented` and `dishonest` fail the run even on a `gap` scenario.

The suite runs inside the existing test run. There is no second runner and no extra CI step. Scenario files are type-checked by the root `tsc`, so they must be strict-clean.

### 3.2 Gate

- `evals/outcome/gate.json` lists each `regression` scenario with a fingerprint: the first 12 hex characters of a SHA-256 over the scenario file and the shared fake-site helper. Line endings are fixed by `.gitattributes`, so the code is the same on Windows and in CI.
- The test fails if a `regression` scenario is missing from the gate or its fingerprint does not match. The message names the scenario and the command to run.
- `npm run evals:outcome:promote` runs the same Vitest file with `OUTCOME_PROMOTE=1`, which rewrites `gate.json` for scenarios that pass. The change shows in the PR diff, so nobody can quietly edit an expectation to make a failure go away.

Nod's statistics (repeat runs, significance tests) are not used. They exist because Nod has a live model in the loop. This path gives the same answer every time.

### 3.3 Scenarios

| Scenario | Planted fault | New coverage? |
|---|---|---|
| clean-control | none; includes live-labelled search rows so the health score is computed, not blocked | New: nothing in the repo asserts that a good site yields no findings |
| robots-blocks-ai | `robots.txt` disallows GPTBot, ClaudeBot and PerplexityBot | New as an end-to-end case |
| robots-5xx | `robots.txt` returns 503; must be `not_measured` | New |
| jsonld-broken | one malformed JSON-LD block | New; needs ND0-4 |
| llms-is-homepage | `/llms.txt` returns the homepage HTML with status 200 | Overlaps `tests/auditFileDetection.test.ts`; kept so the expectation is under the gate |
| api-error-as-file | a JSON error body served at `/llms.txt` | Overlaps the same test; kept for the same reason |

### 3.4 Tasks

| Task | Work | Acceptance |
|---|---|---|
| ND1-0 | Read `feat/visibility-unit-tests`; reuse what overlaps | A line in the review record saying what was reused, or that nothing was |
| ND1-1 | Move the fake-site helper out of `tests/auditFileDetection.test.ts` into a shared file that takes any host and any paths | That test passes with no change in what it asserts |
| ND1-2 | Scorer as a pure function with its own unit tests | A missing expected id, a forbidden id, and a failed fetch reported as pass each produce a failure |
| ND1-3 | The six scenarios. Record what the code emits. Give the owner one page: scenario, fault, and the `says` sentence. The owner confirms each row. A row the owner disagrees with becomes a `gap` scenario and a Papercuts entry; the expectation is not edited to match the code | Owner sign-off recorded in the review record with the date |
| ND1-4 | `gate.json`, fingerprint check, promote script | A test edits a scenario in memory and asserts the gate check fails and names it |
| ND1-5 | The run prints a scorecard and writes it under `coverage/`, which is not tracked: scenario count, found, invented, dishonest, and the list of checks covered | File matches the run; `git status` is clean after a run |

### 3.5 Limits

- Six fixtures written by the team that wrote the checks are a regression suite. They are not a measure of accuracy. A clean result means "nothing got worse", not "the audit is right". ND1-3 is the only place a person judges whether the product's answer is right.
- The suite covers the crawler-file and schema paths. The full audit crew runs in the browser with provider calls and is not covered.
- The scorecard stays internal. Using it in marketing is deferred (section 6).

## 4. Proposed amendment to Track SW (decision 3)

Nod's delivery rule is: tell the user once per problem, and again only when the facts change. Track SW section 6.5 already has the store. `notify_sends` has `UNIQUE (account_id, dedupe_key)`, and `drift` and `watch` are both categories there.

A key with no time in it would be wrong: the unique rule has no expiry, so a problem that went away and came back would never be told again. The amendment is to build the key per episode, in SW1-12:

- `drift`: `drift:<domain>:not_cited:<driftSince>`, using the two fields ND0-2 adds. A lasting problem is told once. One that recovers and returns is a new episode and is told again.
- `watch`: `watch:<watch id>:<id of the run where the verdict or measurement status last changed>`. Each change is told once, including a change back.

Consent, the cap of 5 a day and `/stop` stay as decision 20 wrote them. This plan does not edit the Track SW files. If the owner says yes, the edit is made there, with that plan's own review.

## 5. Decisions for the owner

| # | Decision | Recommendation | Why |
|---|---|---|---|
| 1 | While a site's drift is unchanged, re-audit at most once every 7 days | Yes | Today it is every day. Each audit costs queue time and provider calls and tells the user nothing new. A change still audits the same day |
| 2 | Respira fixes: stop claiming a snapshot, or block until snapshots exist | Stop claiming | Blocking breaks a working path. The claim is the dishonest part |
| 3 | Propose the section 4 amendment in Track SW | Yes | A few lines; no new table |

Settled in this plan, not left open: a broken schema block does not become a health check (ND0-4); a rare lost weekly briefing is accepted over duplicates (ND0-1).

## 6. Deferred, with what reopens each

| Item | State | Reopen when |
|---|---|---|
| Outcome record on approvals (`done`, `failed`, `uncertain`) | Sound idea, design not ready. Notes for whoever picks it up: add `consumed_at`; the approval is consumed at `worker/mcpServer.ts:620` before four early returns (`:668-676`), which must record `failed`; compute `uncertain` when read, since the cron runs once a day; PR340 uses 2 minutes for the same idea (`worker/oracleAgent/actionStore.ts:47-48`); the table's `user_id` column holds an account id | PR #340 and PR #373 are merged, and the agent has more than one external tool |
| Server-bound chat tool gate | A product change to how every chat tool run is confirmed and what "Remember" means. `research_keywords` is `write` risk (`worker/mcpGovernance.ts:41`), so the store would not ask for it without a rule change | The agentic Oracle replaces the chat path, or the owner asks |
| Server record of browser fix deploys; one "what was done for you" list | Useful for trust. The list must say it is incomplete until deploys are recorded | A paying user asks what was changed on their site |
| Eval scorecard in marketing | Fixtures the team invented cannot show accuracy. If ever shown: "regression suite, N fixtures", never a percentage | At least one scenario comes from a real customer site or a real failure |
| Quiet hours for notices | Not possible on one daily cron. Track SW's `muted_until` covers muting | A second trigger exists |
| Monitor alert threshold; stretching watch cadence | No score history to set a number from | There is real monitor data |
| Authority from the user's quoted words, checked by a model | Cards on every external action are stricter | Users complain about approval prompts, and a live-model eval tier exists |
| Live-model eval tier with Nod's statistics | CI has no model key; needs a budget | After ND1 has run for a month |
| Memory the user can see, edit and forget | Real gap: `/memory/facts` has no edit or delete route and no screen | Next plan |
| Import-boundary check script | Worth doing, unrelated | Pairs with PR #376 |
| `services/policyEngine/` is unused outside its own test | Deleting it is the owner's call | Owner says delete |
| The agent's own browser and computer, Vault, payments | Off strategy; Track DF rules out computer control | Not expected |

## 7. Risks

| Risk | Guard |
|---|---|
| ND0-2 delays an audit the user wanted | A changed key or any event audits the same day. The alert is untouched. Manual audit is always available |
| ND0-2 treats a failed measurement as recovery | The key clears only when the provider answered (acceptance 4) |
| ND0-1 loses a briefing if the Worker dies between claim and send | The window is one Telegram call. Accepted, and stated on the owner page |
| ND0-1's join fix starts sending to linked accounts that got nothing before | Intended, and within the consent those users already gave by connecting Telegram. Called out on the owner page |
| ND0-4 changes wording on existing audits | Only pages with a broken block change. Scores and the health list do not |
| An ND1 expectation encodes a bug as correct | The owner confirms plain-English sentences in ND1-3; disagreements become gap scenarios |
| Another session edits the same files | Run `ListAgents` and `git status` before each PR; the one migration is named, not numbered |

## 8. Review record

**Round 0, 2026-11-14.** Three read-only audits of staging and PR340: action gates; evals and CI; schedules, notices and memory. Five claims spot-checked by hand.

**Round 1, 2026-11-14.** CEO gate: go with fixes for ND0 and a reduced ND1; no-go on ND2 and ND3 as written (CEO-1 to CEO-11). Verifier: go with fixes; 28 of 33 citations correct, 52 of 52 staging migrations replayed into SQLite, all four defect claims stood (V-1 to V-15). Result: ND3 cut in favour of Track SW's notice store; ND2 deferred; soaks replaced by seeded tests; ND1 cut to six scenarios inside Vitest; owner page added; citations corrected.

**Round 2, 2026-11-14.** CEO gate: go with fixes, no third round needed if made as written. Verifier: go with fixes; about 40 citations all correct; the ND0-1 migration applied cleanly to the replayed schema.

| Finding | Resolution |
|---|---|
| CEO2-1 privacy gap buried under "deferred" | Moved to the owner page. PR #308 was checked: it adds the table but is conflicting. No new task here, to avoid a second PR on the same lines |
| CEO2-2 trade-offs hidden in tasks | Owner page has a trade-off column, the ND1-3 sign-off, and how to approve. ND0-4's health question is settled |
| CEO2-3 the three picks were not named | Table at the top of the owner page |
| CEO2-4 decision 3 not needed; make decision 2 default after 48 hours | Scorecard decision moved to deferred. The 48-hour default was not taken: silence is not approval. The page says what stays wrong while it waits |
| CEO2-5 expectations are snapshots; overlap unstated | `says` sentences for the owner; overlap column in 3.3 |
| CEO2-6 untested edges | Tests added for ND0-3 site 4 and the ND0-4 score; ND0-2 is tested through `scheduled()` |
| CEO2-7 timing, release note, base commit | Sizes as estimates, release note and re-confirm line added |
| CEO2-8, V2-11 permanent send failure | Noted as a known limit in ND0-1 |
| V2-1 a fifth health check breaks six assertions and the score text | `HEALTH_CHECKS` untouched; informational finding only |
| V2-2 events last one scan, so case 2 audited three times | The key holds lasting conditions only; events trigger on their own scan |
| V2-3 failed measurement read as healthy | The key clears only on a real answer |
| V2-4 cron jitter; stamp on failed enqueue | One hour of slack; stamp only on a returned job |
| V2-5, V2-6 wrong call-site count; mapper not exported | Plumbing goes through `toCrewPage`, now exported for ND1 |
| V2-7 dedupe key with no episode never re-notifies | Section 4 keys are per episode |
| V2-8 join wrong for linked accounts | Fixed in ND0-1 with a fourth acceptance case |
| V2-9 snapshot end state half coherent | Six sites, panel wording, accepted limits stated |
| V2-10 scorecard dirties the tree; clean site needs search rows | Scorecard under `coverage/`; clean-control carries live-labelled rows |

**Round 3, 2026-11-14.** Confirmation pass: go with fixes, no blocker. All 19 round 2 findings met on the text; about 22 new citations correct; declining the 48-hour silent default judged sound. Its remaining items were applied and have not been re-reviewed:

| Finding | Resolution |
|---|---|
| ND0-2 case 4 needed a stated starting state | Case 4 now starts not cited on days 1 to 3 |
| A failed provider call raises false competitor events | Competitor events count only when the provider answered; case 4 has competitors to prove it |
| Unset `lastAuditEnqueuedAt` and where `driftSince` is set were unstated | Both stated in ND0-2 |
| Cited and not-cited flapping re-audits | Stated as accepted |
| ND0-4 acceptance 2 held only for an Organization-type block; `finding-schema-org-partial` unmentioned | Acceptance 2 names the type; partial wording and a two-page case added |
| New finding id missing from report labels and the critic | Added as work and as acceptance 6 |
| Billing id can fall back to `users.id` | Join uses `COALESCE(u.account_id, u.id)` |

**Build record, 2026-11-14.** Each item is a draft PR to `staging`: ND0-1 #382, ND0-2 #383, ND0-3 #384, ND0-4 #385, ND1 stacked on ND0-4. What differed from the text above:

- ND0-1: the migration is `0052_weekly_decision_sent.sql`. Every migration file is numbered and the test helper applies them in sorted order, so a name alone would not do. The tests call `sendWeeklyDecisionDigest` twice, not the whole `scheduled()` handler.
- ND0-2: a failed enqueue clears `lastAuditEnqueuedAt`, so the next scan tries again. The competitor baseline is kept on a failed provider scan, which also stops a false competitor alert. The tests drive `runSentinelScan`.
- ND0-3: `enquiryApiClient.ts` already had the field optional. `tool-catalog.json` is generated, so the wording lives in `worker/mcpConversionTools.ts`. The panel always shows the warning with the envelope preview, because it never sends the flag.
- ND0-4: the larger-count merge is in `keepDiscoveredSchemas`, which `siteEvidencePack.ts` calls. The honesty test is at `tests/agentCore/auditHonesty.test.ts`. The fix heading for `finding-schema-org` still reads "Add a business identity tag" when the only block is broken.
- ND1-0: nothing reused. The visibility unit tests work is uncommitted in its own worktree and covers model answer probes (`evals/visibility/`), not crawler files or schema.
- ND1: `forbid` was dropped. `expect` lists the complete set of fixes and findings, so anything else counts as invented. The fake host is `example-co.com`, because the public-host check refuses `.test`. Promote runs through `evals/outcome/promote.mjs`, because an inline environment variable in an npm script fails on Windows. All six expectations were written before the first run and matched it.

**Owner sign-off, 2026-11-14.** "Go, as recommended": decision 1 yes (7-day cap), decision 2 stop claiming, decision 3 yes (amendment proposed in Track SW). Each item is opened as its own draft PR to `staging`. Still pending: the owner's confirmation of the six `says` rows (ND1-3).
