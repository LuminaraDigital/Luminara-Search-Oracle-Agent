# Outcome dataset capture (Track OD)

**Status:** v0.4. Reviewed for OD0 and OD1, subject to owner decision OD-1. OD2 is reviewed but waits for its start counts. OD3 to OD5 are blocked by gates.
**Date:** 2026-11-01
**Citations:** `origin/staging` at a799c15, unless a line says otherwise.
**Rules:** inherits section 2 of `docs/plans/zoro-concepts-implementation-plan.md`.
**Related:** `docs/plans/domain-agent-training-mixture.md`, `docs/plans/allora-concepts-implementation-plan.md` (section 3.7), Track SW (`founder-swarm-*.md`), `docs/plans/weekly-decision-loop-10x-ship.md` (WDL6).

## 0. Summary

The owner wants proprietary data that could train a Luminara model later. This plan prepares for that on the existing Cloudflare stack. No new vendor is needed: not Daytona, not Freestyle.

Five findings shape the plan:

1. **We have no training data today.** Audit records sit in browser `localStorage`. The exports have no production caller, and their tool trajectories are synthetic.
2. **The outcome chain is broken in D1.** The pieces exist but are not joined: `audit_history`, `audit_findings`, `weekly_decisions`, `citation_watch_runs`.
3. **We may not train on customer audits yet.** The privacy list of uses leaves training out, nothing records acceptance, and no PII redactor exists.
4. **Almost no model-chosen tool calls exist to capture.** Oracle chat picks tools by rule, and the audit crew is a fixed pipeline. A model trained on those learns a script.
5. **13 users cannot train outcome ranking.** The realistic near-term value is correct metadata, evals, and later a small consented set.

The work runs in three stages:

- **From 9 Nov (OD0, OD1):** stop bad data, and record cheap metadata that cannot be recovered later. About two PRs.
- **After the growth gate (OD2):** store outcome history and show it to customers.
- **Gated (OD3 to OD5):** training capture. Off until consent, legal review, a real model-driven surface and volume gates pass.

The existing erasure gaps are a live privacy bug, not dataset work. They move to a separate ticket (section 3) and do not wait for this plan.

**No public claim:** no marketing, privacy or in-app text may promise a custom model, "learns from your data" or "your data improves the AI" until gates G2, G4 and OD3 are all live.

## 1. Evidence

### 1.1 The corpus is not training data

- Stored in `localStorage` only: `services/corpus/aeoCorpusService.ts:86-105`.
- Queries are three templates, not the queries probed: `:143-147`.
- `citationRate` is altered per template and floored at 30, so a measured 0% is stored as 30: `:159`. This breaks the AGENTS.md rule against inventing metrics.
- `status: 'measured'` and `research_log_within_30_days: false` are hardcoded: `:272`, `:326`.
- Trajectories are one fixed script with generated call ids: `:257-356`.
- `trainEligible` ignores consent, and `measurementConfidence: 'failed'` still trains: `:140`.

### 1.2 Real model decisions barely exist

| Surface | Who chooses the tool | Stored server-side |
|---|---|---|
| Oracle chat | Rules, no `tools` in the LLM request (`worker/oracleChat.ts:402-407`, `:704-710`) | Durable Object, capped |
| Native tool loop | The model (`services/geminiService.ts:377-423`) | Nothing. Browser only, off by default |
| Provider relay | Client model | Failure telemetry only |
| MCP | External client's model, reasoning unseen | Redacted args, no output |
| Audit crew | Fixed pipeline | Outputs only |

`run_provenance` forbids raw text by design (`worker/runProvenance.ts:13-14`) and must not be widened.

### 1.3 Broken joins

- `audit_findings.audit_run_id` is `crew_<ts>` (`components/audit/InstantAuditView.tsx:352`). `audit_history.id` is minted separately (`services/geminiService.ts:1019`). Nothing links them.
- A re-audit overwrites the finding row and loses the earlier run (`worker/findingsService.ts:180-188`).
- The report checklist tick never reaches `audit_findings.status` (`services/audit/findingBoardService.ts:261`).
- Only `components/audit/WeeklyDecisionCard.tsx:203`, `:222` PATCH the status.
- `findingStableKey` hashes the title, so a reworded finding looks new (`services/audit/findingStableKey.ts:32-35`).
- `worker/recheckFix.ts:16-68` returns a result and stores nothing.
- `rsi_fix_observations` has no client caller and no run keys.
- Retention deletes rows beyond the newest 500 per account (`worker/auditHistoryRepo.ts:89-95`).

### 1.4 Scores are not comparable over time

- `citationRatePercent` has two definitions under one name: `services/agentCore/agents/serpRadarAgent.ts:147-149` and `services/audit/empiricalCitationService.ts:156`, `:173`, `:191`.
- With 3 queries it can only be 0, 33, 67 or 100.
- `services/visibility/visibilityHistoryService.ts:7-9` says two audits sample different queries.
- Only `citation_watch_runs` compares like with like, through `prompts_sha256` (`worker/citationWatch.ts:326-330`; thresholds in `services/citationWatch/thresholds.ts:25-28`). It needs `CITATION_WATCH_LIVE` and DataForSEO. Production state is unknown.

The strongest honest label is "associated change under a stable prompt set". Never "caused by".

### 1.5 Privacy state

- Uses list omits training: `services/legal/privacyCopy.ts:34`, `:68-76`.
- GDPR bases do not cover it: `:123`.
- No acceptance system exists: `TERMS_UPDATED` and `PRIVACY_UPDATED` are display dates.
- Erasure gaps exist today: `rsi_*` tables, including `rsi_memory_documents` (up to 8,000 characters of text), `business_memories`, `dream_*`, and KV `workspace:${accountId}` (`worker/userStore.ts:614`).
- `audit_findings` is erased but not exported.
- Redaction covers secrets only (`services/security/secretRedactor.ts`, `worker/logRedaction.ts`). Nothing handles emails, phones or names.
- Audit text holds scraped third-party content, including JSON-LD names and phones. That content may not be the customer's to license.

## 2. Plan conflicts to settle

1. `evidence-bound-decision-100x.md` lists "Training a custom decision model" as deliberately not built. Decision OD-1 narrows that.
2. Track SW section 0.3 item 14 leaves AI-answer measurement to the weekly decision loop (WDL2, WDL6b) and Zoro Phase 1. Track OD takes none of that.
3. Track SW section 8.3 says `audit_findings` gets no new column. This plan adds none.
4. `ship_notes` (Track SW 8.2) and `decision_checks` (Allora 3.7) are designed, not built. This plan adopts them and does not define equivalents.
5. `domain-agent-training-mixture.md` line 25 says Luminara exports come "from customer audits", which is false today. Listed for a separate docs edit.
6. A peer session reports a policy (version 2026-11-01), published before lawyer review at luminaradigital.io/terms and /privacy, that says "We do not ... use your workspace or forwarded emails to train our own models". It refers to "LSI", forwarded emails and deal contacts. This product's policy lives at luminarasuite.com, and no such text was found in this repo. OD-2 must establish whether it covers Luminara Suite, and it blocks Stage B. If it does, any training use is a change to published terms, with 30 days' notice where it is not in the user's favour.
7. Allora CL1-1 already exports and erases `audit_findings` and `decision_checks`, and fixes the account-link merge order (3.7). The privacy ticket and OD2-7 take only the other tables and follow that ordering. Check which lands first.
8. WDL6 owns the retest snapshot. OD2 snapshots record which findings a run produced. WDL6 must state which table it reads.

Why existing tables cannot hold OD2 data:

| Table | Why not |
|---|---|
| `audit_findings` | One mutable row per finding per site. History is overwritten |
| `weekly_decisions` | One row per domain per week, covering one finding |
| `ship_notes` (planned) | Records that a fix shipped, not findings per run or every status change |

## 3. Separate ticket: privacy erasure bug

Not part of Track OD and not gated by it. Ship independently.

- Close the erasure gaps in section 1.5, or allowlist a table with a reason (budget ledgers may be kept on purpose).
- Delete KV `workspace:${accountId}` on account deletion.
- Add a coverage test that walks every account-keyed table using `tests/helpers/sqliteD1.ts`, so a new table without a decision fails CI.

PRs 287 and 304 touch `worker/privacyService.ts`, and the owner bulk-merges, so check PR state first.

## 4. Stage: from 9 Nov

### OD0: stop bad data spreading

| Task | Change | Done when |
|---|---|---|
| OD0-1 | Label all corpus rows `provenance: 'synthetic_template'`, and set `trainEligible` false for every row | Test proves no export row claims `real` |
| OD0-2 | Remove the `:159` floor and per-template decrement. Unknown exports as `not_measured` | Test: measured 0 stays 0 |
| OD0-3 | Remove the hardcoded `:272` and `:326` values | Test covers both |

### OD1: cheap joins and metadata

Stored in the existing `audit_history.entry_json`. No migration, no new table. This data cannot be recovered later.

| Task | Change | Done when |
|---|---|---|
| OD1-1 | One run id per audit. Mint `runId` in `InstantAuditView` before `runAuditCrew`, because findings post before the report exists. Replace `crew_<ts>` with it as `auditRunId`. Pass it through the `generateAuditReportUnlessDegraded` input, `AuditReportCrewEvidence.runId`, the `ingestAudit` input and `RecordAuditInput`, and also into the second `recordAudit` call (`instantAuditHelpers.ts:161`), which otherwise replaces the row and erases it. Keep `vault.entry.id` as it is | Test: finding and report share `runId`. A failed audit leaves findings with no history entry, and that is treated as "no report", never an error |
| OD1-2 | Add `runId`, validated with `ID_RE`, else null, to `StoredAuditEntry`, `sanitizeAuditEntry` and `auditFields`/`fieldsToAudit` in `worker/dataPlaneDocs.ts`. All are field whitelists | Round-trip test keeps it |
| OD1-3 | Add model, provider, `method_version`, and the query list with a hash to each audit entry, through the same whitelists. Model comes from `answeredBy` and `answeredByProvider`, whose provider type must widen beyond `'nvidia'`. Queries come from `empiricalSummary.evidenceList[].query`. Export `strings` from `auditHistoryRoute.ts` for the cap, and add a cap on the Firestore side. A field a path cannot supply stores null | Round-trip test. Different `method_version` values never produce a delta |
| OD1-4 | Checklist tick calls `patchFindingStatus` when signed in. This changes visible behaviour, so say so in the PR | Tick reaches D1 for a synced row. An unsynced row retries after sync or resolves by `stableKey` |

The "before" state of a fix is the audit entry named by the finding's run id, so OD1-1 covers it.

WIP limit across Track OD: one PR in flight, and no OD work in the week of a growth gate (5 Nov, 19 Nov, 3 Dec, 28 Dec).

## 5. Stage: after the growth gate

### OD2: outcome history customers can see

Starts after the 19 Nov gate, and only when 25 accounts have 2 or more audits, or 10 of those accounts also have a fix marked done. Below that, nothing would read these tables. Whoever runs the 19 Nov gate review checks this, then at each later growth gate, with read-only production queries:

```text
SELECT COUNT(*) FROM (SELECT account_id FROM audit_history GROUP BY account_id HAVING COUNT(*) >= 2);

SELECT COUNT(DISTINCT account_id) FROM audit_findings
WHERE status = 'done' AND account_id IN
  (SELECT account_id FROM audit_history GROUP BY account_id HAVING COUNT(*) >= 2);
```

`audit_findings` under-counts done fixes until OD1-4 ships. Both queries read D1 only, so they read zero if the Firestore repository becomes active.

| Task | Change | Done when |
|---|---|---|
| OD2-1 | Migration `outcome_spine` (below). Add the file to `REQUIRED_D1_MIGRATIONS` and both tables to `REQUIRED_D1_TABLES` in `scripts/smoke-check.mjs` | Applied on staging |
| OD2-2 | Client still posts the merged board, but builds the POST array explicitly with this run's findings (`mapped`) first and marks them `presentInRun: true`, so the route's `MAX_BULK` cut of 50 keeps them. Add `presentInRun` to `BulkItem`. The route writes a snapshot only for marked items, using `INSERT ... ON CONFLICT(account_id, audit_run_id, stable_key) DO NOTHING`. The upsert sets `audit_run_id = CASE WHEN ? THEN excluded.audit_run_id ELSE audit_findings.audit_run_id END` | Test: a finding the new run did not repeat gets no snapshot for the new run id, and keeps its old `audit_run_id` |
| OD2-3 | `PATCH /findings/:id` writes a status event in the same `DB.batch`, only when `nextStatus !== existing.status`. Server sets `actor` to `'user'`. `reason` stays null until the client sends one | Every status change after creation has an event |
| OD2-4 | Bulk insert of a row with a non-`open` status writes an initial event | Test covers it |
| OD2-5 | Show a finding's history in the report: found, marked done, and the associated change. Only when both measurements share a `method_version` and query hash. Otherwise show `not_measured` | Wording says "associated change", never "caused by" |
| OD2-6 | Persist `worker/recheckFix.ts` results through `decision_checks`, once Allora 3.7 lands | Depends on the Allora gate |
| OD2-7 | Register both tables in export, erase and account-link merge, in the same PR as OD2-1 | Coverage test passes |

Flag `OUTCOME_SPINE_ENABLED`: string var, compared to `'true'`, `"false"` in the top-level block, `env.staging` and `env.production`. Add it to `worker/env.ts`, `PREPROD_GATED_FLAGS` and the four example env files. Do not use `trustFlagEnabled` (`worker/trustReceipts.ts`), which treats an unset `ENVIRONMENT` as on.

Take the migration number at PR time. PRs 287 and 304 both claim 0044.

```sql
CREATE TABLE IF NOT EXISTS audit_finding_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  stable_key TEXT NOT NULL,
  audit_run_id TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  evidence_json TEXT,
  method_version TEXT NOT NULL DEFAULT 'unknown',
  created_at INTEGER NOT NULL,
  UNIQUE (account_id, audit_run_id, stable_key)
);
CREATE INDEX IF NOT EXISTS idx_audit_finding_snapshots_domain
  ON audit_finding_snapshots (account_id, domain, stable_key, created_at);

CREATE TABLE IF NOT EXISTS finding_status_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN ('open', 'in_progress', 'done', 'wont_fix')),
  reason TEXT,
  actor TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_finding_status_events_finding
  ON finding_status_events (account_id, finding_id, created_at);
```

No foreign keys, matching the repo convention.

Known limit: stable keys still change when a title is reworded. Measure the churn rate on staging before designing anything for it.

## 6. Stage: gated training capture

### Gates

All must be true before OD4 starts:

| Gate | Test |
|---|---|
| G1 | Owner approves OD-1 and settles OD-2 |
| G2 | Lawyer reviews the consent wording, third-party content and retention |
| G3 | Provider output terms checked per provider, recorded in this plan |
| G4 | Privacy, Terms, Play declarations and Telegram `/privacy` updated, with 30 days' notice where required |
| G5 | Erasure ticket and OD3 are live |
| G6 | A live worker surface produces model-chosen tool calls. Track SW SW1b or a model-driven Oracle loop. SW1a is deterministic and yields none |

### OD3: consent

Opt-in only, off by default, never bundled into general acceptance.

```sql
CREATE TABLE IF NOT EXISTS training_consent_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('opt_in', 'withdraw')),
  policy_version TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_training_consent_events_account
  ON training_consent_events (account_id, created_at);
```

The latest event decides. Consent is checked at capture and again at dataset build. Toggles sit in `NotificationsPanel.tsx` (web), `TelegramAccountPanel.tsx` and later `SettingsScreen.kt`. PR 287 is the pattern. Do not use a browser flag.

### OD4: capture

| Task | Change |
|---|---|
| OD4-1 | New private R2 bucket with staging and production variants. Never `DESKTOP_RELEASES`. Operator step |
| OD4-2 | PII redactor run server-side before storage. Regex alone cannot catch names, so a row with unresolved risk is dropped |
| OD4-3 | Migration `training_traces`: one row per captured turn, with the R2 key, provider, model, skill version, `provenance`, `consent_event_id`, `redaction_version` |
| OD4-4 | Capture only from the G6 surface. Do not reconstruct tool calls from logs and label them model decisions |
| OD4-5 | Exclude: guest runs, BYOK runs, `crm_contacts`, `enquiries.conversation_json`, property addresses, workspace blobs, YMYL verticals unless G2 allows them |

Flag: `TRAINING_CAPTURE_ENABLED`, set up the same way as `OUTCOME_SPINE_ENABLED`. No backfill: rows captured before opt-in never enter a dataset. Earlier outcome rows made after opt-in may, if the consent wording says so.

Withdrawal stops capture and deletes traces. Deleted accounts are removed, and builds skip ids in `firestore_erase_ledger`. Whether a model already trained must be retired is a G2 question.

### OD5: dataset build (outside this repo)

Follows the mixture plan's rule: no weights, pipelines or datasets here. An operator-only export produces rows labelled `real`, `replayed` or `synthetic`. Holdout splits by account and domain. Missing values export as `null` or `not_measured`. Unmeasured outcomes never become positive labels.

Volume gate before any training run (planning estimate, not a measurement):

- At least 1,000 real multi-turn trajectories, from at least 50 consenting accounts.
- Outcome-trained ranking needs about 200 observations per arm, so it waits longer.
- `evals/` stays out of training. It has 7 cases and is too small to be a holdout, so a frozen tool-mocked task set must be built first.

## 7. Order and cost

| Order | Work | Rough size | Starts |
|---|---|---|---|
| 1 | Privacy erasure ticket | 1 to 2 PRs | Now, independently |
| 2 | OD0 | 1 PR | Week of 9 Nov |
| 3 | OD1 | 1 PR | Week of 9 Nov, or after 19 Nov if OD0 runs long |
| 4 | OD2 | 2 to 3 PRs | After 19 Nov, once the section 5 counts pass |
| 5 | Gates and OD3 | Legal cost plus 1 to 2 PRs | When real volume is in sight |
| 6 | OD4, OD5 | Unsized | After all gates |

## 8. Owner decisions

| # | Decision | If yes | If no | Recommendation | By |
|---|---|---|---|---|---|
| OD-1 | Keep the option of your own small model open? | We collect the right records now, about two PRs. No commitment to train | OD0 still ships. Everything else stops | Yes | 8 Nov |
| OD-2 | Does the TASK-728 "we do not train" draft apply to Luminara Suite? | Training needs that wording changed, with 30 days' notice | Luminara's own policy still needs an amendment | Confirm with that session | Before any legal text moves |
| OD-3 | Pay for a lawyer review? | Unlocks consent and capture | Stage ends at OD2 | Later, when volume is in sight | At step 5 |

## 9. Not verified

Production flags, row counts and applied migrations. Provider terms. Whether BYOK traffic bypasses the relay. Whether any external client calls `/rsi/fixes`. All volume figures are estimates.

## 10. Review record

**Round 1 (2026-11-01).** Audits: backend, privacy, AI/ML. CEO verdict: go with fixes. Verifier: fail on one blocker and five major issues; SQL passed against all 46 migrations and was idempotent.

Applied:

- Blocker: snapshots now use only this run's findings, not the merged board.
- Corrected the SW1 dependency and added gate G6.
- Moved erasure bugs to an independent ticket.
- Deferred outcome tables behind a volume gate, and added a customer-visible task.
- Added early metadata, the no-public-claim rule, the WIP limit, and the reconciliation table.
- Fixed run id threading, flag steps, smoke-check lists, three citations, and cross-plan items.

**Round 2 (2026-11-01).** CEO: all eight findings addressed, go with minor fixes. Verifier: round 1 fixes confirmed, then interrupted before finishing, so the open items were checked directly.

Applied:

- Plan SQL rerun on all 46 migrations, twice, including `training_consent_events`. Passed, and the `to_status` CHECK rejects a bad value.
- Run id now minted in `InstantAuditView`, because findings post before the report exists.
- OD2-2 keeps the merged post, with this run's findings first and marked, which replaces v0.2's `mapped`-only wording.
- Added measurable start queries and a 10-account alternative.
- Start dates moved to the week of 9 Nov, because the WIP rule blocks the week of 5 Nov.

**Final check (2026-11-01).** Verifier on v0.3: three data-flow items failed on missing wiring, and the count queries passed. All three had exact replacement text, now applied in v0.4 with no change to design or scope. v0.4 itself was not re-reviewed. The last CEO verdict was go with minor fixes, on v0.2.
