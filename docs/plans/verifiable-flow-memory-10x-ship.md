# Verifiable Flow and Memory 10x Ship (production + deploy ready)

**Status:** v1.2 - three review rounds applied (section 14). Round 3 verdict: go for V0. No code written. V0 may start; every later phase waits on its own re-baseline and gate.  
**Date:** 2026-10-03  
**Owner:** Luminara Digital (owner gate before every production step)  
**Sources:** OriginTrail "Verifiable Internet for AI" whitepaper v3 pre-publication (concepts only); four specialist code audits and two plan reviews on 2026-10-03  
**Companions:** [`zoro-concepts-implementation-plan.md`](./zoro-concepts-implementation-plan.md) (owns consensus verification, evidence hash and testnet anchoring; its section 2 rules bind this plan), [`weekly-decision-loop-10x-ship.md`](./weekly-decision-loop-10x-ship.md) (product spine), [`agent-mcp-product-surface.md`](./agent-mcp-product-surface.md) (APS invariants)

## 0. Verdict

### 0.1 What this plan is

Two things asked for in one program:

1. Take the usable ideas from the OriginTrail whitepaper (provenance on every claim, tamper-evident history, typed knowledge retrieved before fuzzy recall, rule-derived versus model-inferred) and land them in Luminara without a token, a contract, or a new chain.
2. Make the backend user flow, the AI flow, app smoothness, and the memory of both the AI and the app an order of magnitude better, measured, not asserted.

The audits found that these are the same work. The app cannot attach provenance to a finding today because a finding cannot be joined to a run or to its evidence, and the Oracle cannot remember a project because it is never given one. Fixing the joins fixes both.

They also found defects that come before any of it: a workspace sync that can overwrite newer data, a findings save that fails for every account after the first, a server chat path calling a retired model, and a wasted request on every chat message for most signed-in users. Phase V0 is those.

Two corrections to earlier advice in the planning conversation:

- Evidence hashing and anchoring live in Phase 4 of the Zoro plan, which supersedes Phases 1-4 of `onchain-trust-production-ship.md`. This plan amends that phase (section 8); it does not open a second proof track.
- "Compute the digest in the Worker from stored audit data" is not possible today: the audit runs in the browser and the server stores a shell. Phase V2 gives the Worker real rows to hash. The claim stays "recorded by Luminara, self-reported" until a server fetched the evidence.

### 0.2 Whitepaper concepts: take, adapt, skip

| Concept | Decision | Lands in |
|---|---|---|
| Information provenance (who, when, what source) | Take | V2: evidence items and a provenance envelope on every finding |
| Verifiable information (digests, recorded updates) | Take, inside Zoro Phase 4 | V5-1: the Worker computes the findings hash from its own rows. V2 keeps every observation of a finding, so its history is recorded |
| Merkle trees, inclusion proofs, a hash chain between versions | Defer, with a trigger | V5-2 to V5-4: an audit yields at most four rule findings today, so a tree proves nothing a flat hash does not. Designed, not scheduled |
| Knowledge Asset (addressable, versioned, owned) | Adapt: server-issued run ids, stable finding keys, an observation history. No NFT | V2 |
| Deductive versus inductive knowledge | Take: `derivation` = `rule` or `model` on every finding | V2 |
| dRAG (symbolic retrieval before neural) | Adapt: typed, project-scoped facts and open findings are retrieved by key before any fuzzy match | V3 |
| Paranets (scoped, schema-gated collections) | Adapt: project scope plus schema validation at save | V2, V3 |
| W3C Verifiable Credentials | Defer, decision-gated: a signed receipt for a recorded hash | V5-5 |
| NFT ownership, TRAC and NEURO tokens, knowledge mining, governance votes | Skip. Zoro non-goals already lock this | none |
| Publishing to the OriginTrail network | Skip. A third chain, a funded wallet, and no evidence it improves AI citations | none |

### 0.3 Blockchain: what exists, and what this plan does with it

| Piece | State today | This plan |
|---|---|---|
| TON payments (TonConnect, invoice, verify, ledger) | Configured on mainnet; Zoro's log says the merchant wallet has never received a payment | Untouched. V4-2 changes only when the wallet library loads |
| Network gate (`CHAIN_NETWORK`, fail closed) | Live | Untouched |
| `proof_anchors` ledger | Written only for TON payment receipts | Untouched; Zoro Phase 4 extends it |
| XDC | Read-only health probe | Untouched; Zoro locks "no XDC writes" |
| Audit digest ("Proof of Audit") | Browser-computed, self-reported, stored in KV, badge switched off | Replaced by Zoro Phase 4's evidence bundle; V2 supplies the rows it hashes, V5-1 makes the findings hash server-computed |
| Testnet anchoring | Not built (Zoro Phase 4: a self-transfer carrying the hash, staging only) | Not changed. V5 adds no chain write |

The whitepaper uses a chain for three things: asset ownership, incentives, and a public timestamp for a digest. Only the third applies here, and Zoro Phase 4 already plans it. What this plan adds is upstream of the chain: making the digest worth timestamping.

### 0.4 The 10x scorecard

Every row is a count read from code or a measurement taken in V0-7. No latency number is claimed before it is measured, and every measured number is reported with its sample size.

| # | Dimension | Today | Target | Verified by |
|---|---|---|---|---|
| 1 | Identity resolutions per protected request | 3 on a status poll | 1 | storage spy test |
| 2 | Storage reads before the upstream call on `/providers/*` (every audit's hot path) | 2 identity resolutions, 3 to 4 plan reads | 1 of each | spy test |
| 3 | MCP `tools/call` overhead (API key) | about 8 D1 statements and 7 KV ops, all sequential | Reads in parallel; `last_used_at` and run completion deferred; count fixed by V1-0 | spy test |
| 4 | Saving findings | 2 sequential statements per finding; fails for a second account or domain | One atomic batch; works for every account | two-account test |
| 5 | Wasted server call per chat message, signed-in user without Agency | 1 (a 403, then the browser path) | 0 | request spy |
| 6 | Round trips to save a first project | 3 (list, create, patch) | 1 | integration test |
| 7 | Audit run after a view switch or reload | Lost; the orphaned crew keeps spending quota | Survives a view switch; completed phases restored after reload | component test, manual |
| 8 | Project knowledge in the Oracle prompt | No project context, findings or weekly decision on either chat path | Project digest, weekly decision, open findings, last audit, on both paths | golden prompt test |
| 9 | Memory retrieval | Account-wide, last 50 facts, keyword overlap, no dedupe, questions stored as facts | Project-scoped, typed, deduped, recency-aware | ranking fixtures |
| 10 | Findings that carry derivation, measurement status and evidence refs | 0% | 100% of findings saved through the run ledger | schema test |
| 11 | JavaScript loaded before first interaction | about 640 KB gzip (541 referenced by `index.html`, a 21 KB chunk the entry imports, a 78 KB paywall mounted at start; dist at `71284da`) | 380 KB or less, by the definition V4-0 fixes | CI bundle budget |
| 12 | Render work per chat token | Whole app re-renders, every message re-parsed | Only the streaming row | render-count test |
| 13 | Workspace sync across devices | A stale device overwrites the whole server blob; oversize pushes fail silently | Per-key merge, visible status, no silent loss | unit tests |
| 14 | Latency and error rate: chat first token, Run click to first finding on the board, Run click to report, API p95 | Not measured | Set from the V0-7 baseline, with n | client marks, scripted soak, Workers Logs |

### 0.5 Phases

| Phase | Ships | Migration | Flag |
|---|---|---|---|
| V0 | Defects found by the audits, plus the baseline | none | none |
| V1 | Backend hot path: one identity per request, MCP trim, relay resilience, atomic writes | none | none |
| V2 | Run ledger and provenance envelope | `run_ledger` | `RUN_LEDGER_ENABLED` |
| V3 | Oracle context and scoped memory, on both chat paths | `scoped_memory` | `ORACLE_CONTEXT_ENABLED`, `MEMORY_SCOPED_ENABLED` |
| V4 | App smoothness and app memory (frontend) | none | none |
| V5 | One amendment to Zoro Phase 4 now; Merkle, disclosure, version chain and receipts deferred | none | Zoro's flags |
| V6 | Server-side audit execution | design only | decision-gated |

### 0.6 Non-goals (locked)

- Everything the Zoro plan locks: no token, no DAO, no staking, no contract, no mainnet anchoring, no XDC writes, no zero-knowledge proofs.
- No RDF store, SPARQL, or general knowledge graph. Typed rows in D1 are enough for the retrieval this product does.
- No new chain and no OriginTrail node.
- No router rewrite of `worker/index.ts` and no state-library migration of `App.tsx`. Both are large and neither is on the path of a scorecard row.
- No invented metric, score, or uplift. APS invariant 5 applies to this plan's own claims.

### 0.7 What "ready" means here

V0 and V1 are specified to task level against code that was read on 2026-10-03 and then re-checked by an independent technical review. V2 to V4 cite specialist findings; each starts with a re-baseline task that re-checks every citation against the tree before code is written. V5-1 is an amendment to another plan and waits for that plan's Phase 4. V5-2 onward and V6 are designs, not work orders.

---

## 1. Baseline (2026-10-03)

Rows marked **D** were re-read directly while writing or revising this plan. The technical review confirmed every citation in this section except those corrected in v1.1.

| Area | Finding | Evidence |
|---|---|---|
| Scale **D** | Per Zoro's log: production holds 5 user rows; staging holds 0, has no hosted LLM keys and no Telegram bot. Time-based soaks and log percentiles measure almost nothing on their own. | `zoro-concepts-implementation-plan.md` section 15 |
| Findings save **D** | The client sends the crew's static finding ids and the Worker uses them as a global primary key, while its conflict clause covers only `(account_id, domain, stable_key)`. A second account or a second domain fails with a primary-key error. Reproduced on SQLite by the technical review. | `services/agentCore/agents/playbookAuditorAgent.ts:54,98,115,133`, `services/audit/findingBoardService.ts:137,177`, `worker/findingsService.ts:166`, `:183` |
| Workspace sync **D** | Two effects mark the workspace dirty on mount (Business DNA; a restored chat), so local `updatedAt` beats remote and local is pushed with `force`, which makes the server skip its conflict check. Ordinary pushes send `Date.now()` as their version, so the check can never fire for them either: a stale tab overwrites the whole blob. When a server payload is applied it only writes storage; nothing listens for the restore event, so in-memory state stays stale. The Worker rejects bodies over 64,000 bytes and the client ignores it. Not reproduced at runtime. | `App.tsx:302-309`, `:525-536`, `services/sync/workspaceSyncService.ts:203-213`, `:238-254`, `worker/index.ts:634-650` |
| Server Oracle model **D** | One hardcoded Groq model, no timeout, retry or fallback. A repo comment says that model was shut down on 2026-08-16. A failed call also leaves its `run_provenance` row `running`. Whether Groq rejects it today is not verified. | `worker/oracleChat.ts:210-230`, `services/llm/nativeModelDefaults.ts:6-8` |
| Server Oracle reach **D** | `/oracle/*` is Agency-only. Every other signed-in user's message first calls the server, gets a 403, then falls back to the browser path. | `worker/apiAccess.ts:15-19`, `worker/index.ts:264`, `App.tsx:683-750` |
| Oracle context **D** | The server prompt is the system prompt, up to 5 memory facts and 12 turns: no project, findings or weekly decision. The client sends no project or session id. The browser path has Business DNA, playbooks and local files, and likewise no project context, findings or weekly decision. | `App.tsx:688-692`, `worker/oracleChat.ts:177-201`, `services/geminiService.ts:239` |
| Chat session **D** | `sessionId` defaults to `sess_<userId>`, so every new chat inherits the previous 12 turns. 80 turns stored, no summary. A session can be cleared (`DELETE`), but nothing calls it, and sessions cannot be listed. The session object's name embeds the account id, so it cannot be re-keyed. | `worker/oracleChat.ts:75`, `:106`, `worker/oracleSession.ts:18-37` |
| Memory facts **D** | Written by a regex over the user message, which also stores questions. Account-scoped only: no project, domain, kind, dedupe or decay. Read as keyword overlap over the latest 50 rows. With Vectorize bound but Workers AI unbound, a 64-dimension hash vector would be written to the index. | `worker/memoryRag.ts:118-131`, `:261-277`, `:291-301` |
| Vector bindings | No Vectorize or Workers AI binding in any environment; both are typed optional. | `wrangler.jsonc:126`, `worker/env.ts:161-163` |
| Rate limiter **D** | Every allowed hit rewrites the KV TTL, so the window never resets under steady traffic and a user well under the rate is eventually blocked. Read-then-write is not atomic. The high-cost edge limit is 20 per minute in code and production, 30 on staging. | `worker/securityHardening.ts:249-271`, `worker/index.ts:166`, `wrangler.jsonc:170-174`, `:253-257` |
| Identity | `identify()` runs 3 times on a status poll (7 D1 statements); each run is a KV read, a D1 select and a D1 upsert. `/auth/link` is deliberately unguarded so that no upsert happens before the user confirms. | `worker/authMiddleware.ts:155-157`, `:211`, `worker/apiAccess.ts:80`, `worker/userStore.ts:72-98` |
| Agency gate **D** | A regex list sends every `/oracle`, `/audit` and `/tools` path to the Agency check before any handler runs. Route placement cannot exempt a path. | `worker/apiAccess.ts:15-19`, `worker/index.ts:264` |
| MCP | Sequential JSON-RPC loop; the handler is not given the execution context. A thrown tool error becomes HTTP 500 and drops the batch. A retried `save_report` fails "already exists" without the id. The budget gate deliberately runs before, and wins over, every governance outcome. `not_measured` results and research-log hits are billed. There are no finding tools. | `worker/index.ts:1469`, `worker/mcpServer.ts:432`, `:523`, `:613`, `:671-676`, `worker/agentReportService.ts:199-207` |
| Provider relay | Upstream fetch has no timeout or retry. Quota is charged before the call and never refunded; the charge can be a referral credit spent by compare-and-swap. | `worker/providerRelay.ts:275`, `:351`, `worker/quotaMiddleware.ts:82`, `worker/referrals.ts:86-116` |
| Writes | `updateProjectContext` commits operations one by one; a bad third operation returns 400 after two landed. | `worker/projectContextService.ts:214-396` |
| Audit location | The full audit runs in the browser. The crew makes zero LLM calls; every board finding comes from four hardcoded rules. The model writes only the Markdown report, which is never parsed into findings. Findings are saved at crew end, before the report. | `services/agentCore/agents/playbookAuditorAgent.ts:52-144`, `components/audit/InstantAuditView.tsx:290-316`, `services/geminiService.ts:722-769` |
| Finding provenance **D** | A finding has free-text `evidenceSource` and a hardcoded confidence: no URL, fetch time, method, status or hash. The run id is a client string; the upsert overwrites `audit_run_id`, so history is lost. `run_provenance` has no Instant Audit surface. | `services/agentCore/types.ts:107-126`, `components/audit/InstantAuditView.tsx:300`, `worker/findingsService.ts:147`, `:183-184`, `worker/runProvenance.ts:21-26` |
| Honesty gaps **D** | The critic marks every finding it does not reject as verified, and filters on that flag. Formula scores count as measured. The report prompt asks the model for impact, rank and 0-100 columns that nothing validates. The Gemini fallback sends no system prompt. | `services/agentCore/criticReflectionEngine.ts:76-100`, `services/agentCore/agents/serpRadarAgent.ts:128-131`, `services/geminiService.ts:756-763`, `:962-973` |
| Tool loop **D** | Client tool results are folded into the prompt unfenced. | `services/tools/runToolLoop.ts:73-100` |
| Audit durability | Run state is component state. A view switch unmounts the audit and the orphaned crew keeps spending quota; a reload loses the run. The report phase shows no loader. | `components/audit/InstantAuditView.tsx:138-159`, `:241-244`, `:313`, `App.tsx:1530` |
| Queue path **D** | `POST /audit/run` is Agency-gated, enabled in every environment, and has no UI caller. A failed `send` strands a `queued` row; the dead-letter queue has no consumer. | `worker/index.ts:1670-1694`, `worker/auditQueue.ts:67-91`, `:255-264`, `wrangler.jsonc:122` |
| Chat render | Each token re-renders the whole app, re-parses every message, smooth-scrolls, and writes two storages. | `App.tsx:729-739`, `components/MessageList.tsx:19`, `:180` |
| First paint | 541 KB gzip referenced by `index.html`; the entry statically imports a 21 KB chunk; the paywall (78 KB) is lazy but mounted unconditionally. | `dist/index.html`, `App.tsx:72`, `:1810`, `index.tsx:4`, `:40` |
| App memory | Chat (last 60), drafts and the findings board live in sessionStorage. Last view, answer mode, lenses and window bounds are not persisted. Notebooks never sync. | `App.tsx:304`, `:331`, `services/audit/findingBoardService.ts:39-56`, `electron/main.cjs:128-131` |
| Privacy **D** | Account deletion does not remove `audit_runs`, `audit_findings`, projects, the research log or Oracle sessions. Account linking only rewrites `users.account_id`; no data table is re-keyed, so the losing account's rows are orphaned. | `worker/privacyService.ts:153-196`, `worker/userStore.ts:329-338` |
| Deploy **D** | The deploy workflow migrates D1, deploys, then smokes, for both environments, with no backup step. The production job re-runs the test suite, so a flaky test blocks a flag flip. The Worker bundle gets no build identifier. Next free migration is 0018; next free spec is 0015. | `.github/workflows/deploy-cloudflare.yml:59-83`, `:121-145`, `wrangler.jsonc:5`, `migrations/`, `specs/` |
| Branches **D** | `feat/mcp-governance-hardening` equals `origin/staging` at `71284da`. `origin/main` (`5cbfcad`) is one merge commit ahead with an identical tree, so it is not an ancestor of `origin/staging`. Local `staging` is 59 commits behind origin; local `main` is current. | `git rev-parse`, 2026-10-03 |
| Observability | `/api/health` has no build identifier and no D1 probe. No alerting. Workers Logs are enabled. Sentry is called only from the top-level catch. | `worker/index.ts:267-305`, `:1746`, `wrangler.jsonc:8` |

### 1.1 Not verified (each is resolved by a named task)

- Whether Groq rejects the hardcoded model today, and how many `oracle_chat` runs are stuck `running` (V0-2).
- Real workspace payload sizes against the 64 KB cap; provider calls per Instant Audit against the edge limit (V0-7).
- The Workers plan tier, which sets the D1 queries-per-invocation limit (V2-0).
- Which audit fetches already pass through the Worker (V2-0).
- What `evidence_json` holds today across writers (V2-0).
- Whether cron triggers apply in the staging and production blocks (V2-0).
- Hosted LLM keys on staging: Zoro's log says there are none (V0-2, V3-0; Zoro owner decision 9).
- Whether a D1 batch counts as one query or as many against the per-invocation limit (V2-0).
- Whether the `/memory/*` routes, open to any signed-in user today, are meant to stay open on every plan (V3-0).
- Whether Telegram webviews keep storage across reopen (V4-6).
- Whether `jose` EdDSA signing runs under workerd (V5-5, if ever started).

### 1.2 Known gaps this plan records but does not own

- **Alerting beyond a health check, and a dead-letter consumer.** V0-7d adds a scheduled health check. Queue hardening is a V6 prerequisite.
- **The flag kill switch is test-gated.** In an emergency the switch is `wrangler rollback --env production`, which needs no CI; the flag PR follows.
- **MCP finding tools** belong to the weekly decision loop plan; when built, they return the V2 envelope.
- **Account linking orphans data.** Linking rewrites `users.account_id` and nothing else, so every table keyed by the losing account id is stranded. Zoro P2-6 moves the credit ledger. This plan moves only the tables it creates or extends (V2-1b, V3-1b). The workspace, projects and the remaining account-keyed tables are not moved by any plan yet.

---

## 2. Rules for every task

The Zoro plan's section 2 applies: gates (2.1), feature flags (2.2), release procedure (2.3), rollback (2.4), migration rules (2.5), privacy rule (2.6), double-check protocol (2.7), licence keys (2.8). Read it before the first task. The deltas below come from the 2026-10-03 deploy audit and reviews.

### 2.1 Deltas

- **Branch from `origin/staging`**, never from local `staging` (59 commits stale).
- **Release path is an open decision (owner decision 8).** AGENTS.md says `main` requires a pull request; Zoro 2.3 step 7 pushes `staging:main` as a fast-forward; the last release was a PR (#37) whose merge commit `origin/staging` now lacks. The agent asks when the first production promotion is requested. If the owner approves the promotion without choosing, it goes as a PR from `staging` to `main`, followed by merging `main` back into `staging`.
- **CI migrates on merge with no backup.** The operator backs up and records the Time Travel bookmark before merging any PR that carries a migration (Zoro 2.3 steps 2 and 6).
- **Migration and spec numbers are assigned at PR time.** Next free today: migration 0018, spec 0015. Zoro's `consensus_trust` and `proof_anchor_v2` are also unnumbered. This plan refers to its migrations by name.
- **Soaks are scripted, not waited for.** Staging has no users. Every soak in this plan means: the flag on in staging, the V0-7 soak script run against it on each day of the soak, and its report (n, p50, p95, errors) attached to the promotion PR. A soak with no traffic is not a soak. The script drives Worker endpoints only. The audit itself runs in a browser, so "an audit completes" is always an owner check, never a script result.
- **Signed-in web flows need a human.** Firebase sign-in is a real external account, so an agent cannot click through them. Each phase lists what the owner checks by hand.
- **Fail closed on gating.** A new route never widens an existing guard pattern. It gets its own prefix and its own entry in the protected-route list.
- **D1 limits.** At most 100 bound parameters per statement; a per-invocation query limit that depends on the plan tier. Every batch endpoint states its maximum statement count and rejects a request that would exceed it.
- **Upserts against a partial or expression index repeat the index's expression and `WHERE` clause**, or SQLite reports that the conflict target matches no constraint.
- **New endpoints are added to `worker/README.md`** in the same PR. New invariants go in the folder's README.
- **No new binding or secret without an operator step.** A CI dry-run does not prove a resource exists.
- **One concern per PR.** Worker changes, frontend changes and migrations do not share a PR unless the task says the migration ships with its only reader.

### 2.2 Flags added by this plan

Declared in all three `vars` blocks of `wrangler.jsonc`, typed in `worker/env.ts`, documented in the three example env files, default `"false"`, reported in `/api/health` so the client can branch on them.

| Flag | Phase | Off means |
|---|---|---|
| `RUN_LEDGER_ENABLED` | V2 | The `/runs/*` routes return 503 `RUN_LEDGER_DISABLED`; the client keeps today's `crew_<time>` id and `/findings/bulk` |
| `ORACLE_CONTEXT_ENABLED` | V3 | Both chat paths build exactly today's prompt; session ids, compaction and the conversation index are inactive |
| `MEMORY_SCOPED_ENABLED` | V3 | Memory reads and writes ignore the new columns and behave as today |

V0, V1 and V4 carry no flag. They are fixes and refactors, where a flag would double the code paths in auth and rendering. Their safety is equivalence tests, a scripted staging soak, and `wrangler rollback` plus `git revert`.

### 2.3 Double-check protocol (binding, in addition to Zoro 2.7)

After every task:

1. Re-run the task's acceptance test and read its output.
2. `npm run typecheck` and the targeted tests.
3. Grep for the regression the task could cause (named in the phase's double-check line).
4. Fix what the check finds, then re-run steps 1 to 3. A task is not done while a check is red.

After every phase:

1. Full gates: `npm run typecheck && npm run lint && npm test && npm run test:coverage && npm run build`, plus `npm run evals`.
2. Staging smoke, the scripted soak, and the phase's manual check.
3. Re-read this plan's section against the merged code and correct whichever is wrong.
4. Independent review by a reviewer who did not write the code. Blockers are fixed and the review is re-run before the status line changes.
5. Update the status line and the execution log (section 15).

At the end of the plan: repeat the phase check for every phase against production, re-measure every scorecard row, and record the result next to its target. A row that missed its target is reported as missed.

---

## 3. Phase V0 - Fix what is broken, measure the rest

**Goal:** no known data-loss, failed-save or dead-path defect remains, and every scorecard row has a baseline with a sample size.

| ID | Task | Files | Acceptance | Size |
|---|---|---|---|---|
| V0-1 | Workspace sync, minimal safe fix. (a) Neither mount-time effect marks the workspace dirty: mark only when the stored value changes. (b) Local meta gains a separate base version, the server `updatedAt` last synced (today's `updatedAt` is the dirty timestamp and cannot serve). Pushes send the base version, and the stale-device branch stops sending `force`, so the server's conflict check runs. (c) On a conflict the client stashes the losing local values under one capped key, applies the server payload, rehydrates in-memory state from it (Business DNA and chat listen for the restore event, which nothing does today), and shows a notice naming the keys that differed. A rejected push shows a notice too. The notice is a small inline surface built in this task; V1-7 later folds it into the shared toast. The stash key is local only and never joins the synced key list. The task lists, from the sync key list, every synced key that has in-memory state (watchlist, agency workspaces and the rest) and rehydrates each. (d) Update invariants 3 and 5 in the workspace README. V4-3 (per-key merge) follows V0 directly and replaces (c). | `App.tsx:302-309`, `:525-536`, `services/sync/workspaceSyncService.ts:187-254`, `worker/index.ts:634-650`, `services/workspace/README.md`, new `tests/workspaceSync.test.ts` | Mount with unchanged DNA and a restored chat leaves local `updatedAt` untouched. A stale tab pushing over a newer server row gets a 409, does not overwrite it, and afterwards holds the server's DNA in memory, so its next edit builds on the server's value. The losing local values are recoverable from the stash. The notice renders for a conflict and for a 400 or 413. | M |
| V0-2 | Oracle model call. First confirm the outage read-only: the operator counts `run_provenance` rows with surface `oracle_chat` still `running` after an hour. Then: an ordered server-side candidate list taken from the shared defaults, a request timeout, one retry on a model-gone response, and the run marked failed on any LLM error. If Zoro P1-4's `callHosted` has landed, build on it; if not, keep this inside `worker/oracleChat.ts` and let P1-4 absorb it. | `worker/oracleChat.ts:203-230`, `services/llm/nativeModelDefaults.ts:6-8`, `tests/` | A mocked "model not found" on candidate 1 streams from candidate 2. A hung upstream ends with an `error` event inside the timeout and a `failed` run row. No model id string remains inline in the handler. **Promotion needs one live call:** staging hosted keys (Zoro decision 9), or the owner sends one Agency chat on production right after deploy and confirms the answer came from the server path. The default model is a different model family from the retired one, so the owner also reads that answer for tone. | S |
| V0-3 | The Gemini fallback sends the system prompt. | `services/geminiService.ts:962-973` | Test asserts the fallback request carries the same system instruction as the primary path. | S |
| V0-4 | Rate limiter: a true fixed window. Put the window number in the key, so a new window is a new key and the TTL (at least 60 seconds, the KV minimum) is only cleanup. Document that KV is not atomic and that the edge limiter binding is the hard stop. | `worker/securityHardening.ts:213-278`, tests | One request every half window, under the limit, is never blocked across five windows. A burst over the limit is blocked. A new window starts with a zero count. | S |
| V0-5 | Audit report phase: explicit phase state (`crew`, `report`, `done`, `error`) and a skeleton during report generation. Retry and New domain stay enabled once the crew is terminal (deliberate, per the comment at `:242`), but a re-run aborts the in-flight report request. | `components/audit/InstantAuditView.tsx:241-244`, `:313`, `:618-626`, `:725` | Component test: the skeleton is visible between crew completion and report arrival; a second Run click aborts the first report request and exactly one report lands. | S |
| V0-6 | Fence tool results in the client tool loop with the same untrusted-content wrapper the Worker uses. | `services/tools/runToolLoop.ts:73-100` | An injection fixture in a tool result ("ignore previous instructions") arrives inside a fenced data block; snapshot test. | S |
| V0-7a | Health identifies the build and probes D1. `/api/health` gains `build` and `d1Ok` (a `SELECT 1`). The build identifier reaches the Worker as a deploy variable (`--var BUILD_SHA:<sha>`) in both deploy steps of the workflow; local deploy scripts get it through a small node wrapper, because a shell substitution in `package.json` does not expand under cmd on Windows. Typed in `worker/env.ts`. | `worker/index.ts:267-305`, `worker/env.ts`, `.github/workflows/deploy-cloudflare.yml:69-77`, `:131-139`, `package.json`, new `scripts/deploy-with-sha.mjs` | Health shows the deployed SHA on both environments and `d1Ok:true`. | S |
| V0-7b | One redacted timing line per API request through `safeLog`: route template, status, duration. | `worker/index.ts`, `worker/logRedaction.ts` | No timing line carries a user id, domain or query string (redaction test). | S |
| V0-7c | Client marks, sent through the existing product analytics path: chat first token, Run click to first finding, Run click to report, provider calls per audit, first load. | `services/apiClient.ts`, `components/audit/InstantAuditView.tsx`, `App.tsx` | The marks arrive for one owner-run audit and chat on staging. | S |
| V0-7d | A soak script that drives Worker endpoints with operator-supplied staging credentials and reports n, p50, p95 and error count per route. A scheduled workflow that calls the health endpoint for both environments and fails loudly when `ok` is false. | new `scripts/soak.mjs`, new `.github/workflows/health-check.yml` | The script exits non-zero on any 5xx and prints n beside every percentile. The workflow fails on a forced bad health response (tested with a wrong URL). | M |
| V0-7e | Fill the section 15 table. | section 15 | A number and an n in every cell that can be measured; a cell that cannot (no staging LLM keys, no users) says so. | S |
| V0-8 | Findings save works for every account. The Worker issues the row id and ignores a client-supplied one; the conflict key `(account_id, domain, stable_key)` stays the identity. Replace the per-finding statement pair with one `DB.batch`. | `worker/findingsService.ts:153-220`, `services/audit/findingBoardService.ts:137`, `:177`, tests on `tests/helpers/sqliteD1.ts` | Two accounts and two domains save the same four rule findings: all succeed, each sees only its own rows. A repeat save updates in place. A request with one invalid finding skips that item and counts it, as today, and writes the rest in one batch. | S |
| V0-9 | No doomed server call. The client calls the server Oracle only when the plan has `apiAccess`; everyone else goes straight to the browser path. The plan comes from the quota response, so a message sent before it has loaded awaits the in-flight quota request; if that fails, the browser path is used. | `App.tsx:683-684`, `services/apiClient.ts:380-397`, `services/plans/planEntitlements.ts` | Request spy: a signed-in user without Agency sends zero requests to `/oracle/chat`, including for a message sent immediately after load. An Agency user still uses the server path. A failed quota request falls back to the browser path. | S |

**Order:** V0-1 and V0-8 first (lost and failed writes). V0-7a to V0-7d early so the baseline accrues. The rest are independent small PRs.

**Phase V0 double-check:** grep `worker/` for an inline model id; grep `App.tsx` for `noteWorkspaceDirty` and confirm no call runs on mount; grep the sync service for `force` and confirm no automatic path sets it; run the two-account findings test against the real upsert; confirm the honesty baseline count did not rise (`.honesty-baseline.json`); confirm the timing line passes the log-redaction tests.

**Promote when:** gates green; staging smoke green; the soak script green with at least 100 requests per route; and the owner has, on staging: (1) signed in on two browsers, edited Business DNA on the stale one, and seen the conflict notice with the newer value kept; (2) run one audit on each of two accounts, after which `GET /api/findings` for each account returns that account's findings (the board itself is per-tab storage until V2-9, so a reload proves nothing).

---

## 4. Phase V1 - Backend hot path

**Goal:** scorecard rows 1 to 3 and 6, with no schema change.

| ID | Task | Files | Acceptance | Size |
|---|---|---|---|---|
| V1-0 | Re-baseline: re-check every section 1 citation for this phase; write the storage spy helper (counts D1 statements and KV operations per request, and records which ran sequentially); record today's exact counts for rows 1 to 3 and fix row 3's target. | this document, `tests/helpers/` | Citations corrected; counts and the row 3 target recorded in section 15. | S |
| V1-1 | One identity and one plan read per request, lazily. Memoise `identify()` and the active-subscription lookup per `Request`, so guards and handlers share one resolution without resolving anything a route did not ask for. Throttle the `last_seen_at` write to once per session per hour. | `worker/workerUtils.ts:114-245`, `worker/quotaMiddleware.ts:27`, `worker/authMiddleware.ts:211`, `worker/apiAccess.ts:80`, `worker/userStore.ts:72-98`, `worker/index.ts:230-265` | Equivalence test: for fixture requests (session, API key, OAuth token, Telegram init data, `tg_sess_` session, dual credential, KV-only mode, guest, expired, CSRF-failing, `/license/activate`) the result is the same principal or the same rejection as today. `/auth/link` without `{confirm:true}` performs no user-store write. Spy: one identity resolution and one subscription read per request; a repeat request within the hour writes no `last_seen_at`. | M |
| V1-2 | MCP hot path. Thread the execution context into the MCP handler and tool context. Read plan, budget and approval state in parallel. Defer only `last_used_at` and run-provenance completion. The budget gate still runs before and wins over governance, and the hash-chained audit log is written before the response, exactly as today. | `worker/index.ts:1469`, `worker/mcpServer.ts:89`, `:426-470`, `:613-654`, `worker/apiAccess.ts:99-135`, `worker/apiKeyService.ts:92-100` | Spy meets the row 3 target set in V1-0. A budget-halted account is still blocked before any tool runs. The audit log row for a call exists when its response returns (ordering test). Paid tools still refuse without loaded project context (APS invariant 3). Deferred writes land (test awaits them). | M |
| V1-3 | MCP errors and idempotent saves. A thrown tool error becomes a JSON-RPC result with `isError` and a code, and the rest of the batch still runs. `save_report` with the same project and title returns the existing id. | `worker/mcpServer.ts:671-676`, `worker/agentReportService.ts:199-207` | A batch of three calls where the second throws returns three results. A repeated `save_report` returns the same id and writes one row. | S |
| V1-4 | Provider relay resilience. Add a timeout and one retry on 502 or 503 before the first byte. Keep reserving quota before the call, and refund on an upstream failure before the first byte: the daily counter is decremented, and a spent referral credit is re-granted through the ledger with a unique reason per request. Streams are never retried or refunded after the first byte. | `worker/providerRelay.ts:275`, `:351`, `worker/quotaMiddleware.ts:82`, `worker/referrals.ts:86-116` | A hung upstream returns a coded error within the timeout and the quota counter is back where it started. One 503 then 200 yields one charge. A failed call that spent a referral credit restores exactly one credit, once, even if the refund runs twice. A mid-stream failure is neither retried nor refunded. | M |
| V1-5 | Atomic project context updates: validate every operation, then commit in one `DB.batch`. | `worker/projectContextService.ts:214-396` | A request whose third operation is invalid returns 400 and writes nothing. | S |
| V1-6 | Rate limits. Use the V0-7 count of provider calls per audit to set the high-cost limit; make the code constant, the staging binding and the production binding agree. | `worker/index.ts:166`, `:242-257`, `wrangler.jsonc:170-174`, `:253-257` | One value in code and both bindings, above the V0-7c count of provider calls per audit. The owner's staging audit completes without a 429. | S |
| V1-7 | Client request layer. In-flight dedupe and stale-while-revalidate for quota, projects and findings; wire the existing transient retry; one toast surface for 429, offline, sync error and sync conflict. | `services/apiClient.ts:51-117`, `:224`, `:240`, `components/paywall/UsageQuotaBadge.tsx:12-14` | Two components mounting together issue one quota request. A 429 shows a toast with the retry time. The V0-1 sync events render. | M |
| V1-8 | Honest save errors. A signed-in user whose save fails sees the real reason, not "Sign in". | `services/projects/projectClient.ts:106-112`, `components/audit/InstantAuditView.tsx:359` | A 500 on save renders the server's error code and a Retry action. | S |
| V1-9 | First project in one call: create accepts the initial context. | `services/projects/projectClient.ts:61-113`, `worker/index.ts:1473-1490`, `worker/projectContextService.ts` | Saving a first project issues one request and is atomic: a bad context writes no project. | S |

**Order:** V1-0, then V1-1 alone (it touches auth), then the rest in parallel.

**Phase V1 double-check:** run the equivalence fixtures again after every later task that touches `worker/index.ts`; confirm CSRF and App Check rejections are unchanged; confirm no paid tool became reachable without project context; confirm licence redemption still works (Zoro 2.8).

**Scripted soak:** 3 days. **Promote when:** the spy targets hold; the soak script reports zero 5xx and p95 no worse than the V0-7 baseline, with n at least 200 requests per route; the owner has clicked through sign-in, an audit and an MCP call on staging.

---

## 5. Phase V2 - Run ledger and provenance envelope

**Goal:** every audit has a server-issued run, every finding saved through it says how it was derived, how well it was measured and which evidence it rests on, and the history of a finding is kept.

### 5.1 Design

**Routes.** A new `/runs` prefix, added to the protected-route list (guests get 401) and left out of the Agency pattern. The existing `/audit/*` routes and their Agency gate are not touched.

| Method | Path | Does |
|---|---|---|
| POST | `/runs/start` | Inserts an `audit_runs` row (`origin='client'`, `status='running'`, with the required `domain` and `focus`) and a `run_provenance` row with a new `instant_audit` surface. Returns the server-issued run id. Idempotent on a client idempotency key. |
| POST | `/runs/:id/findings` | Called when the crew is terminal, before the report, as today's save is. One atomic `DB.batch`: evidence rows, finding upserts, one observation per finding. Idempotent: a repeat returns the stored result. |
| POST | `/runs/:id/finish` | Sets status, `run_meta_json` and the report reference; completes the run provenance row. |
| GET | `/runs`, `/runs/:id` | List and detail, account-scoped, with `ETag` and 304. |

Limits: the existing cap of 50 findings; at most 40 evidence items; a body cap sized for that and stated in the handler; the dual rate limit called explicitly, because these paths are not in the high-cost list. `/runs/:id/findings` writes up to 140 rows (40 evidence, 50 upserts, 50 observations). It uses multi-row inserts, each under the 100-parameter limit, which brings the batch to about 20 statements, plus the identity, ownership and idempotency reads. V2-0 confirms that fits the plan tier's per-invocation limit, and lowers the caps if not. A run id that belongs to another account returns 404.

**Keys, not ids.** Nothing in this phase uses a client-chosen global id. Evidence is keyed `(account_id, audit_run_id, ref)`, where `ref` is a short key the client makes unique within the run. An observation is keyed `(account_id, audit_run_id, stable_key)`. A finding lists the `ref`s it rests on, and the handler rejects a `ref` not present in the same request.

**Provenance envelope.** Two axes, kept separate:

- `derivation`: how the finding was produced. `rule` (a deterministic playbook check, with `ruleId`) or `model` (an LLM inferred it).
- `measurementStatus`: how good the evidence is. The existing tri-state `measured`, `estimated`, `not_measured`. This is not Zoro's citation verdict (`verified`, `contradicted`, `unverified`), which stays a separate field on citation claims and is not merged into it.

An evidence row records `kind`, `url`, `fetchedAt`, `fetcher`, `httpStatus`, `contentSha256`, its own `measurementStatus`, and an optional `sourceRef` pointing at a row that already holds the content (`ai_answer_captures`, or Zoro's `citation_verifications` once it exists). It indexes evidence; it does not copy it. A finding with no evidence `ref` is `not_measured` by construction.

**Trust model, stated plainly.** The client submits everything in V2, so every evidence row is written with `fetcher='client'`. The column allows `worker` for later: V2-11 would let the Worker mint a receipt when it fetches a page itself, and only a row backed by such a receipt may say `worker`. UI wording does not change: nothing in V2 lets a screen say "verified".

**Abandoned runs.** A closed tab leaves a run `running`. The daily cron marks any `running` client run older than 24 hours `abandoned`. The promotion check counts abandoned runs; it does not pretend they are zero.

**Model output.** The Markdown report stays. In V2-7 the model is additionally asked for JSON findings that cite evidence `ref`s; each is validated, and a finding that cites no known `ref` is dropped from the board. Numeric columns appear only when a measured evidence row supplies the number; otherwise the cell reads "not measured".

### 5.2 Migration `run_ledger`

```sql
ALTER TABLE audit_runs ADD COLUMN origin TEXT;
ALTER TABLE audit_runs ADD COLUMN idempotency_key TEXT;
ALTER TABLE audit_runs ADD COLUMN run_meta_json TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_runs_idem
  ON audit_runs(account_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS audit_evidence (
  account_id TEXT NOT NULL,
  audit_run_id TEXT NOT NULL,
  ref TEXT NOT NULL,
  kind TEXT NOT NULL,
  url TEXT,
  fetched_at INTEGER NOT NULL,
  fetcher TEXT NOT NULL CHECK (fetcher IN ('client','worker','sidecar')),
  http_status INTEGER,
  content_sha256 TEXT,
  measurement_status TEXT NOT NULL
    CHECK (measurement_status IN ('measured','estimated','not_measured')),
  source_ref TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, audit_run_id, ref)
);

CREATE TABLE IF NOT EXISTS finding_observations (
  account_id TEXT NOT NULL,
  audit_run_id TEXT NOT NULL,
  stable_key TEXT NOT NULL,
  domain TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  derivation TEXT NOT NULL CHECK (derivation IN ('rule','model')),
  rule_id TEXT,
  measurement_status TEXT NOT NULL
    CHECK (measurement_status IN ('measured','estimated','not_measured')),
  evidence_refs_json TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, audit_run_id, stable_key)
);
CREATE INDEX IF NOT EXISTS idx_finding_obs_key
  ON finding_observations(account_id, domain, stable_key, observed_at);
```

- Validated on SQLite against migrations 0001 to 0017 (section 14).
- `audit_evidence.kind` gets a `CHECK` enum in the PR; its values are fixed by V2-0 against the evidence types that exist (`services/scraping/siteEvidencePack.ts`, `services/audit/empiricalCitationService.ts`).
- The three `ALTER`s are not idempotent: confirm via `migrations list` that the file is unapplied before running (Zoro 2.5).
- An upsert on `idx_audit_runs_idem` must repeat its `WHERE` clause (rule 2.1).
- The new tables declare no foreign key to `audit_runs`, as `audit_findings.audit_run_id` does not either: older rows hold client-made run ids with no run row. The handler checks the run exists and belongs to the account.
- `audit_findings` is not altered. The current envelope goes in the existing `evidence_json` under a `provenance` key; the history goes in `finding_observations`.
- `run_meta_json` holds model, provider, rule-set version, playbook version and client build. No prompt text, no user text.

### 5.3 Tasks

| ID | Task | Files | Acceptance | Size |
|---|---|---|---|---|
| V2-0 | Re-baseline and spec. Re-check section 1 citations; list the evidence kinds; list which audit fetches pass through the Worker; record what `evidence_json` holds across writers; confirm the Workers plan tier and D1 limits; confirm cron triggers per environment. Write the spec. | this document, new `specs/<next>-run-ledger-and-provenance.md` | Section 5 corrected; the `kind` enum, the limits and the caps are recorded. | S |
| V2-1 | Migration; smoke lists; flag in three blocks, `worker/env.ts`, example env files and health. Privacy: export and delete for both new tables, and close the existing gap by deleting `audit_runs` and `audit_findings` on account deletion (owner decision 9). | `migrations/`, `scripts/smoke-check.mjs`, `worker/privacyService.ts:52-101`, `:153-196`, `wrangler.jsonc`, `worker/env.ts` | Applies clean on a D1 at 0017. After deleting an account, no row with its id remains in the four tables. `validate-env` passes in both modes. | S |
| V2-1b | Account linking moves this plan's tables: `audit_runs`, `audit_findings`, `audit_evidence`, `finding_observations`. One helper re-keys the losing account's rows in the link batch. Only `audit_findings` can collide (both accounts audited the same domain): the row with the later `updated_at` is kept and the other deleted, in that order, so nothing is left under the old id. The credit ledger stays with Zoro P2-6, whose rule is to merge and sum; every other table stays as recorded in 1.2. | `worker/userStore.ts:300-345`, new `worker/accountLinkMove.ts`, tests | Link two accounts that each hold runs and findings for the same domain: the four tables hold no row under the old id; each colliding finding survives once, as its later version; non-colliding rows all move. The ledger and workspace are untouched by this helper (asserted). | M |
| V2-2 | Types: `EvidenceItem`, `FindingProvenance`; the tri-state `MeasurementStatus` used by audit context and findings. Zoro's citation verdict is left as its own type. | `services/agentCore/types.ts:82-126`, `:154`, `services/tools/types.ts:6` | Typecheck. Audit context no longer uses a binary measured flag (grep). | S |
| V2-3 | Rules emit provenance. Each of the four playbook rules gets a stable `ruleId` and its evidence `ref`s. Formula scores are `estimated`. The critic records a status (`checked`, `unchecked`, `rejected`) instead of a verified flag, and drops only `rejected`. | `services/agentCore/agents/playbookAuditorAgent.ts:52-144`, `services/agentCore/agents/serpRadarAgent.ts:128-131`, `services/agentCore/criticReflectionEngine.ts:76-100` | The fixture audit returns the same number of findings as today (asserted, non-zero). Each has `derivation='rule'`, a `ruleId`, and either an evidence `ref` or `not_measured`. A finding the critic has no rule for is `unchecked`, not verified, and is still returned. The honesty baseline count does not rise. | M |
| V2-4 | One crawl, one evidence pack. The scout and the report path share one fetch result per URL, keyed by content hash. | `services/agentCore/agents/scoutAgent.ts:57`, `services/geminiService.ts:592`, `services/scraping/siteEvidencePack.ts:29-38` | A fixture audit fetches each URL once (fetch spy). | M |
| V2-5 | Worker routes per 5.1, flag-gated, with the `instant_audit` run surface, the protected-route entry, the explicit rate limit and the statement cap. | new `worker/runLedger.ts`, `worker/index.ts`, `worker/authMiddleware.ts:151-170`, `worker/runProvenance.ts:21-26`, `worker/README.md` | Flag off: 503. Guest: 401. Free signed-in user: 200. Findings twice: one set of rows, same response. An unknown evidence `ref`: 400 and nothing written. Another account's run id: 404. Two accounts saving the same refs and stable keys both succeed. A request that sends `fetcher:"worker"` is stored as `client`. `/audit/run` still requires `apiAccess` (existing test still passes). | M |
| V2-6 | Client run store. A module-level store keyed by run id owns the crew, so a view switch does not unmount the run; the view re-subscribes. An `AbortSignal` runs through the state graph; sign-out, leaving for good or re-running aborts. Events and completed-phase results persist, size-capped; after a reload the view restores completed phases and re-runs only what is missing. Findings are saved at crew end, as today. | `components/audit/InstantAuditView.tsx:138-159`, `:290-316`, `services/agentCore/stateGraph.ts:90`, new `services/audit/runStore.ts`, `App.tsx:1530` | Switch view mid-audit and return: progress continues and one run exists. Abort stops provider calls (spy). Reload after the crew phase: findings are shown and only the report is requested. Flag off: today's behaviour. | L |
| V2-7 | Structured model findings per 5.1, as its own PR after V2-1 to V2-6 have soaked. | `services/geminiService.ts:722-769`, `worker/agentOutputValidators.ts`, `evals/` | A model finding citing an unknown `ref` is dropped. A numeric cell without measured evidence renders "not measured". Recorded-output eval fixtures cover both. | L |
| V2-8 | UI: derivation and measurement chips on findings; the evidence drawer lists URL and fetch time. Sequence with Zoro P1-10, which edits the same drawer. | `components/audit/EmpiricalEvidenceDrawer.tsx`, findings board components | Snapshot per chip state. No chip says "verified". | S |
| V2-9 | Findings board outlives the tab: hydrate from `GET /findings` on load, keep a local copy, seed the dashboard from the server. | `services/audit/findingBoardService.ts:39-56`, `components/suite/DashboardView.tsx:43-55` | Open a second browser signed in to the same account: the board shows the first browser's findings. | S |
| V2-10 | Abandoned-run sweeper on the existing daily cron. | `worker/scheduledJobs.ts`, `worker/index.ts:1877-1885`, `tests/scheduledJobs.test.ts`, `worker/runLedger.ts` | A `running` client run older than 24 hours becomes `abandoned`; a younger one is untouched; queue runs are untouched. The job list test names the new job. | S |
| V2-11 | Deferred, designed only: Worker-minted evidence receipts for fetches the Worker performs, so a row may say `fetcher='worker'`. Starts only if V2-0 finds such fetches on the audit path. | none yet | A design note in the spec. | - |

**Order:** V2-0, then V2-1 and V2-1b in one PR (Zoro 2.6 wants a table's privacy and link move in the PR that creates it), then V2-2 to V2-5 in parallel, then V2-6, V2-8, V2-9, V2-10. V2-7 last.

**Phase V2 double-check:** grep `services/` and `components/` for a default of `verified` or `measured` on a finding; confirm the Agency pattern list is unchanged; confirm a deleted account leaves no rows in the four tables; confirm the run store is the only owner of an in-flight crew; confirm no code path writes `fetcher='worker'`.

**Scripted soak:** 7 days with the flag on. **Promote when:** the soak script has completed at least 50 ledger runs (scripted start, findings and finish calls, not browser audits) with zero 5xx, no two runs share an idempotency key, every saved finding has an envelope, the abandoned count equals the number of runs the script deliberately left open, and the owner has run and reloaded an audit on staging. **Production gets** the migration and code with the flag off; turning it on is its own one-line PR.

---

## 6. Phase V3 - Oracle context and scoped memory

**Goal:** the Oracle answers about this project using what Luminara already knows, on whichever chat path the user's plan takes, and memory belongs to a project, has a type, and does not repeat itself.

### 6.1 Design

**Two chat paths, one assembler.** The server path serves Agency; everyone else chats through the browser path (section 1). The context builder is therefore a pure function in `services/`, used by both. The Worker loads its inputs from D1; the browser loads the same inputs through the existing project, findings and weekly-decision endpoints and keeps what it already has (Business DNA, playbooks, local files). Whether the server path opens to other plans is owner decision 1, which has no default: until it is answered, V3 improves the server path for Agency and the browser path for everyone else.

**Context assembly.** Blocks, in order, with caps:

| Order | Block | Cap | Source |
|---|---|---|---|
| 1 | System prompt (static) | as today | bundled or `agent_skills` |
| 2 | Project digest | 2,000 chars | `project_context_sections` |
| 3 | Active weekly decision (title, why, verify-by) | 600 chars | `weekly_decisions` |
| 4 | Open findings, top 5 by severity, each with derivation and measurement label | 1,500 chars | `audit_findings` |
| 5 | Last audit summary | 800 chars | `audit_runs` |
| 6 | Typed memory facts, up to 5 | as today | `memory_facts` |
| 7 | Conversation summary | 1,200 chars | Durable Object |
| 8 | Recent turns | as today (12 server, 20 browser) | Durable Object or client |
| 9 | User message and fenced tool results | as today | request |

Static and slow-changing blocks come first so a provider that caches prompt prefixes can reuse them. Blocks 2 to 7 are wrapped as untrusted content with the existing wrapper: they contain crawled and user-supplied text. Caps are characters, because token counts were not measured; V3-0 restates them in tokens if the provider reports usage. A loader refuses a project the account does not own.

**Conversation identity.** The client creates a conversation id per chat, keeps it per project, and sends it with the project id. "New chat" makes a new id. The Durable Object key keeps its shape, so no Durable Object migration is needed. Because Durable Objects cannot be listed, a D1 table indexes conversations; it is what lets the app list them and lets export and deletion reach them. Each index row stores the session object's full name as created (`object_name`). That name embeds the account id of the time and cannot be changed, so account linking re-keys the row's `account_id` but never `object_name`, and every later read resolves the object from `object_name`. The session object already clears its turns on `DELETE`; deletion needs a caller, not a new route. The legacy default session `sess_<userId>`, which predates the index, is cleared by name for each of the account's user ids.

**Compaction.** When stored turns exceed 24, the handler asks the model for a rolling summary of the oldest turns after the response has finished streaming. The work is registered with the execution context (today the handler starts its stream with a bare `void run()` and is not given the context), has a timeout under 30 seconds, and stores the summary in the session. If the call fails or times out, behaviour is today's last-12 window.

**Memory.** Facts gain a project, a domain, a kind (`brand`, `offer`, `location`, `audience`, `competitor`, `preference`, `constraint`), a content hash and a last-seen time. Questions are not stored. A repeated fact bumps last-seen instead of inserting. Reads take project facts first, then account-level facts, ranked by kind, keyword overlap and recency. Vector search runs only when both the index and the embedding model are bound; a hash-vector is never written to a remote index. The memory routes are open to any signed-in user today, so the browser chat path reads and writes the same store through them (V3-6b); V3-0 confirms that is intended for every plan, and scorecard row 9 reaches exactly the plans those routes serve.

**Research cache.** The research log gains the tool name, an argument hash and the structured result, so the 30-day reuse check (APS invariant 3) is an exact lookup that returns the data, not a substring match that returns a summary line.

**Validators.** One behaviour, no either-or: when a `block`-level validator fires, the stream ends with a `correction` event, the UI renders a notice on that answer, and the stored assistant turn carries the notice so later turns see it. No second model call.

### 6.2 Migration `scoped_memory`

```sql
ALTER TABLE memory_facts ADD COLUMN project_id TEXT;
ALTER TABLE memory_facts ADD COLUMN domain TEXT;
ALTER TABLE memory_facts ADD COLUMN kind TEXT;
ALTER TABLE memory_facts ADD COLUMN content_hash TEXT;
ALTER TABLE memory_facts ADD COLUMN last_seen_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_memory_facts_scope
  ON memory_facts(account_id, project_id, kind, last_seen_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_facts_dedupe
  ON memory_facts(account_id, COALESCE(project_id, ''), content_hash)
  WHERE content_hash IS NOT NULL;

ALTER TABLE project_research_log ADD COLUMN tool TEXT;
ALTER TABLE project_research_log ADD COLUMN args_hash TEXT;
ALTER TABLE project_research_log ADD COLUMN result_json TEXT;
ALTER TABLE project_research_log ADD COLUMN measurement_status TEXT;
CREATE INDEX IF NOT EXISTS idx_research_log_cache
  ON project_research_log(project_id, tool, args_hash, created_at);

CREATE TABLE IF NOT EXISTS oracle_conversations (
  account_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  object_name TEXT NOT NULL,
  project_id TEXT,
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_oracle_conv_project
  ON oracle_conversations(account_id, project_id, updated_at);
```

- Validated on SQLite against migrations 0001 to 0017 (section 14): the dedupe index rejects the same hash twice in one project, allows it in two projects, and treats a missing project as one bucket.
- Writers store a missing project as `NULL`, never `''`. The upsert repeats the index expression and its `WHERE` clause (rule 2.1).
- Existing facts keep `NULL` in the new columns and read as account-level, untyped. No backfill.
- `result_json` is capped at 64 KB per row and follows the log's existing 90-day pruning.
- Nine non-idempotent `ALTER`s: confirm unapplied before running.

### 6.3 Tasks

| ID | Task | Files | Acceptance | Size |
|---|---|---|---|---|
| V3-0 | Re-baseline and spec. Record hosted LLM key state per environment (Zoro decision 9); record owner decision 1; confirm what the provider reports for token usage. | this document, new `specs/<next>-oracle-context-and-memory.md` | Section 6 corrected; without staging keys the plan states that the server path cannot soak. | S |
| V3-1 | Migration; smoke; flags. Test both indexes on a local SQLite D1. | `migrations/`, `scripts/smoke-check.mjs`, `wrangler.jsonc`, `worker/env.ts` | Applies clean. The three dedupe cases behave as stated in 6.2. | S |
| V3-1b | Privacy. Export covers the new columns, the conversation index and the stored turns of each indexed conversation. Deletion clears each indexed session object by its `object_name` (the existing `DELETE`), clears the legacy `sess_<userId>` session for each of the account's user ids, then removes the index rows, projects, project context and the research log, which survive deletion today (owner decision 9). Account linking moves `oracle_conversations` (never `object_name`) and memory facts through the V2-1b helper; a memory dedupe collision keeps the survivor's row. | `worker/privacyService.ts:52-101`, `:153-196`, `worker/oracleSession.ts:18-37`, `worker/oracleChat.ts:106`, `worker/accountLinkMove.ts` | An export contains the turns of an indexed conversation. After deleting an account: no conversation rows, no stored turns in an indexed or legacy session, no projects, no research log rows. After linking two accounts, a conversation started before the link still returns its turns. | M |
| V3-2 | Client sends project id and conversation id; "New chat" rotates the id; ids persist per project. Active only when health reports the flag on. | `App.tsx:688-692`, `services/apiClient.ts:754-763` | Flag on: the request carries both, and after "New chat" the prompt holds no turn from the previous conversation. Flag off: the request is byte-identical to today's. | S |
| V3-3 | Shared context assembler per 6.1: a pure builder in `services/`, a Worker loader, a browser loader. | new `services/oracle/contextAssembler.ts`, new `worker/oracleContext.ts`, `worker/oracleChat.ts:177-201`, `services/geminiService.ts:239` | Golden prompt test per block combination, run for both callers. Every cap holds on oversized input. A foreign project id yields 404 and no load. Flag off: both paths build today's prompt exactly. | M |
| V3-4 | Session compaction per 6.1; the execution context is passed to the Oracle handler and the stream's work is registered with it. | `worker/index.ts:1667`, `worker/oracleChat.ts:328-334`, `worker/oracleSession.ts:18-37` | 30 turns in: the prompt holds a summary and 12 turns. Summary call fails or exceeds its timeout: 12 turns, no error to the user. The `done` event is written before the summary call starts (test asserts ordering). Flag off: no summary call. | M |
| V3-5 | Memory writes: skip questions; kind classification by rule; content hash on normalised text; project scope from the chat's project; last-seen bump on repeat. | `worker/memoryRag.ts:281-346` | A question stores nothing. The same sentence twice stores one row with a later `last_seen_at`. A fact written in project A is not returned for project B. Flag off: today's insert. | M |
| V3-6 | Memory reads per 6.1, plus the embedding guard. | `worker/memoryRag.ts:118-131`, `:192-278`, `:348-358` | Ranking fixtures pass. With an index bound and no embedding model, no upsert is sent. | M |
| V3-6b | The browser chat path uses the hosted memory store: it reads facts through the memory search route for block 6 and writes through the extract route after a turn, both with the project id. Signed-out users keep today's local-only memory. This sends chat text from users without Agency to the server for the first time, so V3-0 checks that the privacy notice covers it, and the V3-1b export includes the resulting facts and extraction rows. | `services/geminiService.ts:239`, `services/apiClient.ts`, `worker/index.ts:1245-1262`, `worker/memoryRag.ts:360-387` | A signed-in user without Agency states a brand fact in project A, starts a new chat in project A and the fact is in the prompt; in project B it is not. Flag off: no memory route is called from the browser path. | M |
| V3-7 | Structured research cache per 6.1. A cache hit returns the stored result. Billing follows owner decision 2. | `services/tools/researchLogGate.ts:32-49`, `services/tools/paidResearch.ts:14`, `services/tools/registry.ts:91`, `worker/mcpServer.ts:523` | The same tool and arguments within 30 days make no upstream call and return the full result. A `not_measured` result is billed or not per the recorded decision; a test asserts it. | M |
| V3-8 | Validators act, per 6.1. | `worker/oracleChat.ts:261-280`, `worker/agentOutputValidators.ts`, `App.tsx` chat stream handler | An invented-metric fixture ends with a `correction` event; the UI shows the notice; the stored turn contains it. No extra model call (spy). | S |
| V3-9 | Durable chat on the client: an interrupted answer is marked and offers Continue; the project's conversation list is restored from the index on a second device (server path). | `App.tsx:302-309`, `components/MessageList.tsx`, `worker/index.ts`, `worker/oracleContext.ts` | Reload mid-answer: the partial turn is labelled and Continue resumes. A second device lists the project's conversations. | M |
| V3-10 | Evals: golden prompts and ranking fixtures in CI; a live-model eval run by hand before promotion, where keys exist. | `evals/`, `.github/workflows/ci.yml` | CI fails when a golden prompt changes without its fixture. The eval report is attached to the promotion PR, or the PR states that no keys were available. | S |

**Order:** V3-0, then V3-1 and V3-1b in one PR (Zoro 2.6), V3-2, then V3-3 with V3-5 and V3-6 in parallel, then V3-6b, V3-4, V3-7, V3-8, V3-9, V3-10.

**Phase V3 double-check:** confirm every injected block is fenced (grep for the wrapper at each call site); confirm no cross-project and no cross-account read (tests with two accounts and two projects); confirm paid tools still require loaded project context; confirm account deletion clears sessions and removes vectors before fact rows; confirm every V3 behaviour is inert with its flag off.

**Scripted soak:** 7 days. The browser path is checked by the owner with their own provider key. The server path needs hosted LLM keys on staging and an Agency test account; without them it does not soak and does not promote. **Promote when:** golden prompts and ranking fixtures are green; the soak has at least 100 scripted server-path turns where keys exist, with zero 5xx; prompt size stays inside the caps on the soak's largest project; the owner has asked five questions about a real project on each available path and each answer used that project's facts; no `block`-level validator result reached the user without its notice; first-token latency is recorded against the V0-7 baseline with its n and the owner accepts it.

---

## 7. Phase V4 - App smoothness and app memory

**Goal:** scorecard rows 11 to 13. No flag, in parallel with V1 to V3. Frontend only, except V4-3, which also changes the Worker's workspace write path and follows V0 directly.

| ID | Task | Files | Acceptance | Size |
|---|---|---|---|---|
| V4-0 | Re-baseline. Define "loaded before first interaction" (scripts referenced by `index.html`, chunks the entry imports statically, and anything mounted at start), write the budget script to that definition, and add a render-count test helper. | this document, `tests/helpers/`, new `scripts/bundle-budget.mjs`, `.github/workflows/ci.yml` | The script reports today's number by that definition and fails at the limit. Row 11's "today" figure is replaced by the script's output. | S |
| V4-1 | Chat streaming cost. An isolated chat store; memoised message rows with cached HTML; tokens batched per animation frame; scroll only when already at the bottom; storage written at stream end. | `App.tsx:302-309`, `:729-739`, `components/MessageList.tsx:19`, `:180` | Render-count test: a token for row N re-renders row N only. Sanitised HTML output is identical to today's for the fixture messages. | M |
| V4-2 | First paint. Load the wallet library and mount the paywall on first open; dynamic-import the model clients and the message list; idle-prefetch the likely next view. The paywall's mount-time quota fetch goes with it, so the quota request that V0-9 relies on must still be issued at start by the request layer. | `index.tsx:4`, `:40`, `App.tsx:3-4`, `:15`, `:72`, `:495`, `:1810`, `vite.config.ts:134-142`, `services/apiClient.ts:380-397` | The budget script reports 380 KB gzip or less. The quota request is still sent at start (V0-9's spy test still passes). The paywall opens on web and desktop on staging (owner). A Mini App checkout on staging needs Zoro P0-6 and P0-12 (testnet wallet and staging bot); until those land, the owner opens the paywall in the production Mini App after deploy and confirms the wallet button renders, without paying. | M |
| V4-3 | Workspace sync v2, directly after V0. Per-key timestamps and merge; a visible sync status; flush on `pagehide`; notebooks added to the sync list. The Worker's write sanitiser is extended to accept the per-key timestamps (it rejects unknown fields today), and the workspace route gets its own body cap (owner decision 6) instead of the shared small-body constant, which also guards auth, invoice and webhook routes and is not raised. Replaces V0-1's apply-and-notify conflict handling. | `services/sync/workspaceSyncService.ts`, `services/notebook/notebookService.ts:176-179`, `worker/index.ts:634-650`, `worker/securityHardening.ts:121`, `worker/security.ts:71`, `worker/userStore.ts`, `services/workspace/README.md` | Two devices editing different keys both keep their edits. Two devices editing the same key: the later edit wins and the status says a merge happened. An oversize payload shows a status. No key present on either side is ever dropped. A payload in the old shape is still accepted. The shared small-body cap is unchanged (asserted on an auth route). | M |
| V4-4 | Restore place and preferences: last view, answer mode, focus and lenses, Electron window bounds. Drop the fixed splash delay. | `App.tsx:138-149`, `:331`, `components/audit/InstantAuditView.tsx:122-123`, `electron/main.cjs:128-131`, `:182` | Reopen the desktop app: same view, same window size. | S |
| V4-5 | Skeletons for the share, teaser, verify and agent report views; caps on the per-audit digest keys, the virtual file store and notebooks. | `components/audit/VerifyAttestationView.tsx:58`, `services/agentCore/tonAttestationService.ts:95-103`, `services/vfs/vfsStorageService.ts:165-169` | Each view shows a skeleton while loading. Storage stays under its cap in a 200-audit fixture. | S |
| V4-6 | Mini App: find out whether the webview keeps storage across reopen; if not, keep the last view in Telegram CloudStorage. | `components/telegram/`, `services/telegram/` | A recorded finding, and if needed the last view restored after reopen. | S |

**Phase V4 double-check:** DOMPurify still sanitises every rendered message (test); the budget script shows no wallet, paywall or model client in the first-interaction set; the workspace merge never drops a key present on either side.

**Promote when:** the bundle budget and render-count test hold in CI, and the owner has used chat and an audit on web and desktop on staging, plus the paywall check in V4-2.

---

## 8. Phase V5 - Proof amendments (edits to Zoro Phase 4)

**Goal:** when Zoro Phase 4 builds the evidence hash, the Worker computes the findings part from rows it holds. Nothing here ships before Zoro Phase 4 starts, and nothing here adds a chain write.

### 8.1 Now: one amendment

| ID | Amendment | Changes in the Zoro plan | Acceptance | Size |
|---|---|---|---|---|
| V5-1 | Server-computed findings hash. For a run that has ledger rows, `findingsSha256` is computed by the Worker from the run's `finding_observations` rows (sorted by `stable_key`) and `audit_evidence` rows (sorted by `ref`), not from client-supplied strings. That form carries its own version, `luminara.evidence.v2`. A run with no ledger rows keeps Zoro's client-supplied form, `luminara.evidence.v1`. Verify handles both and says which it checked. The hash stays a pure function of the stored rows, so Zoro P4-3's "same bundle twice: one row, same hash" holds unchanged. | 7.1 canonical form; P4-2; P4-3; P4-6 | Owner approves the edit (decision 7). The hashed document still contains no domain, URL or run id. The same run hashed twice gives the same hash. Changing one stored observation changes it. A v1 bundle and a v2 bundle both verify, each labelled with its version. | S |

### 8.2 Deferred, with a trigger

The first draft of this plan scheduled a Merkle tree, per-finding disclosure, a version chain and signed receipts. The reviews cut them, and the reasoning holds: an audit yields at most four rule findings today, so a tree and selective disclosure prove nothing a flat hash does not; a `prev` link has no reader until the chain is displayed; and the version field already lets either be added later without breaking stored bundles.

**Trigger to schedule V5-2 to V5-4:** V2-7 has shipped (model findings raise the count well past four) and Zoro P4-6 (public verify) is live.

| ID | Design, recorded so it is not re-derived |
|---|---|
| V5-2 | Merkle module. Leaf hash is SHA-256 of a `0x00` byte, a fixed 32-byte random salt and the canonical leaf; node hash is SHA-256 of a `0x01` byte and the two children; an odd level is split as in RFC 6962, never by duplicating the last node; the empty tree's root is SHA-256 of the empty string. Finding leaves sort by `stable_key`, evidence leaves by `ref`. Salts and leaves are stored beside the bundle, outside the hashed document, fixed at first submission. The technical review confirmed the construction has no n versus n-plus-repeat collision. |
| V5-3 | Disclosure. The owner mints a disclosure for one finding (leaf, salt, path). Anyone can check it against a recorded hash. The public verify endpoint stays hash-lookup only and returns no finding content. |
| V5-4 | Version chain. A `prev` field holds the evidence hash of the account's previous bundle for the same domain, set by the Worker once at first submission, and shown on verify only when `public_domain=1`. It arrives with a new version of the canonical form; earlier bundles simply have no link. |
| V5-5 | Signed receipt, decision-gated (owner decision 4): the Worker signs `{hash, recordedAt, network}` with an Ed25519 key whose public half is published with a key id. It would make "recorded by Luminara" checkable without calling Luminara, in production, where no chain is used. Needs a new secret per environment. |

**Wording does not change.** A hash or a tree proves the record has not changed. It does not prove the audit was right. The UI line stays "Recorded by Luminara on <date>. Self-reported audit, not independently checked."

**Phase V5 double-check:** alter one stored observation and confirm the recomputed hash no longer matches the bundle; confirm nothing but the hash goes on-chain; re-run Zoro's on-chain wording grep.

---

## 9. Phase V6 - Server-side audit execution (design, decision-gated)

Not a work order. Recorded because three limits in this plan come from one cause: the audit runs in the browser.

- **What it unlocks:** a run that continues with the tab closed, resume on another device, scheduled re-audits, and evidence the server fetched (the only route to dropping "self-reported").
- **Why it is not in V2:** the report step uses the user's own provider key, which lives in the browser. Server execution needs hosted keys for that step (a cost and entitlement decision) or it covers only the crawl and rules.
- **What V2 already prepares:** the run id, the evidence table and the save routes are the same for a server run; `origin` distinguishes them.
- **Prerequisites if approved:** queue hardening first (an idempotency key and budget check on enqueue, retries not swallowed by the consumer's catch-all, a dead-letter consumer, a sweeper for stale `queued` rows), then move the crawl and the four rules behind the queue consumer, then status over the existing poll with `ETag`.
- **Decision needed:** owner decision 5.

---

## 10. Dependency graph and sequencing

```
V0-1, V0-8 (lost and failed writes) -> V0-2..V0-6, V0-9 (small PRs) ; V0-7 (baseline, early)
   |
   +-- V4-3 (workspace merge, directly after V0)
   |
   +-- V1-0 -> V1-1 (identity memo) -> V1-2..V1-9
   |              |
   |              +-- V2-0 -> V2-1 -> V2-1b -> V2-2..V2-5 -> V2-6, V2-8..V2-10 -> V2-7
   |                                              |
   |                                              +-- V3-0 -> V3-1 -> V3-1b -> V3-2 -> V3-3, V3-5, V3-6 -> V3-6b, V3-4, V3-7..V3-10
   |                                              |     (server path needs V0-2 live and staging LLM keys)
   |                                              |
   |                                              +-- V5-1 (needs V2 rows, owner decision 7, and the start of Zoro Phase 4)
   |
   +-- V4-0 -> V4-1, V4-2, V4-4..V4-6   (frontend, parallel from the start)

V5-2..V5-4: after V2-7 and Zoro P4-6.   V6: after V2, on owner decision 5 only.
```

| Rule | Detail |
|---|---|
| Parallel lanes | Worker lane (V1, then V2 Worker tasks, then V3) and frontend lane (V4, then V2-6, V2-8, V2-9, V3-9) |
| Shared files | `worker/index.ts` and `App.tsx` are touched by many tasks. One open PR per file at a time; rebase before review |
| Zoro coordination | V0-2 and Zoro P1-4 share the hosted call; V2-8 and Zoro P1-10 share the evidence drawer; V5-1 edits Zoro section 7; V4-2's Mini App check depends on Zoro P0-6 and P0-12. Whichever lands first owns the code; the other builds on it |
| Production | Explicit owner approval in chat for every production step; owner decision 8 is asked at the first. Flags stay off in production until the phase's promotion criteria are met |

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| V1-1 changes auth for every route | Lazy memo, not a new resolution order; equivalence fixtures across every credential type; ships alone; scripted soak; rollback is `wrangler rollback` plus revert |
| The sync fix trades one silent loss for another | V0-1 stashes the losing values, refreshes in-memory state and shows which keys differed; V4-3 follows directly with per-key merge; tests assert no key is dropped |
| Account linking orphans conversation turns, or other data | The index keeps the session object's original name and resolves from it; this plan moves only its own tables and records the wider gap in 1.2 |
| A migration is auto-applied by CI with no backup | Operator backs up and records the bookmark before merging (rule 2.1); all migrations additive |
| A new route silently inherits or escapes a guard | New prefix, own protected-route entry, never widening an existing pattern; tests for guest, free and Agency on each route |
| Soaks on an empty staging prove nothing | Scripted soak with n reported; owner hand-checks listed per phase; anything unmeasurable is stated, not assumed |
| Provenance labels read as proof of correctness | Two axes, plain wording, no "verified" in V2, no `fetcher='worker'` without a receipt; only Zoro Phase 1 can say verified |
| The critic change drops findings | Acceptance asserts the fixture finding count is unchanged and non-zero |
| Larger Oracle prompt costs more and slows first token | Caps per block; V0-7 baseline; flag is the kill switch; owner accepts the measured latency before promotion |
| Prompt injection through crawled text now in the Oracle prompt | Every injected block is fenced with the existing wrapper; V0-6 fences the client tool loop; injection fixtures in evals |
| Cross-project or cross-account leakage through context or memory | Ownership check in every loader; two-account, two-project tests; facts scoped by project |
| Memory and conversations keep personal data longer or in more places | Conversation index makes sessions deletable; deletion and export updated in the same PR as each table; vectors deleted before rows |
| Refunds are abused or double-paid | Refund only before the first byte; ledger refund reason is unique per request; test runs the refund twice |
| Deferring MCP writes forks the audit hash chain | The audit log stays synchronous; only `last_used_at` and run completion are deferred |
| A batch exceeds D1 limits in production | Caps and a statement count in the handler; V2-0 confirms the plan tier before the caps are final |
| Lazy-loading the wallet library breaks checkout in the Mini App | V4-2 paywall check; full checkout check once Zoro P0-6 and P0-12 land |
| The client run store leaks a running crew | Single owner of in-flight runs; abort on re-run and on sign-out; spy test |
| Account-link re-keying loses or duplicates rows | One batch; collisions keep the survivor's row; test with data on both sides |
| Licence keys stop redeeming | Zoro 2.8 check before and after every production deploy |
| Scope creep into a router or state-library rewrite | Non-goals in 0.6 |

---

## 12. Owner decisions needed

| # | Decision | Blocks | Default if no answer |
|---|---|---|---|
| 1 | Does the server Oracle stay Agency-only? | Who gets server-side memory, sessions and validators | None. Until answered, V3 improves the server path for Agency and the browser path for everyone else |
| 2 | Paid tools: are `not_measured` results and research-cache hits billed? | V3-7 | Not billed |
| 3 | Bind Vectorize and Workers AI for memory search (a recurring cost and an operator step)? | Vector path in V3-6 | No. Typed, scoped D1 retrieval only |
| 4 | Signed receipts (a new signing key per environment)? | V5-5 | Deferred |
| 5 | Server-side audit execution, and with it hosted keys for the report step? | V6 | Not started |
| 6 | Workspace size budget (today 64,000 bytes) | V4-3 | 256 KB, revisited after V0-7 measures real payloads |
| 7 | Approve amending Zoro section 7 per V5-1 | V5-1 | None; needs a yes |
| 8 | Release path: PR from `staging` to `main` (AGENTS.md, and what PR #37 did), or fast-forward push (Zoro 2.3)? | How each production step is carried out | PR to `main`, then merge `main` back into `staging`. Asked at the first production promotion |
| 9 | Should account deletion also remove audit runs, findings, projects, the research log and Oracle conversations (it does not today)? | V2-1, V3-1b | Yes |

Also needed from Zoro's list: decision 9 (hosted LLM keys on staging), which gates the live check in V0-2 and the server-path soak in V3.

---

## 13. Immediate next action

1. V0-1 and V0-8, with tests (agent): the two defects that lose or fail a write today.
2. V0-2: the operator runs the read-only stuck-run count; the agent ships the model fix.
3. V0-7a to V0-7d: baseline instrumentation and the soak script (agent), so numbers accrue.
4. Owner: decisions 8 and 9 before any production step; then 1, 2, 6, 7; and Zoro decision 9.

Nothing is deployed to production without an explicit yes in chat.

---

## 14. Review record

| Round | Reviewers | Verdict | Outcome |
|---|---|---|---|
| 0 | Four specialist audits (backend, AI and memory, frontend, deploy), read-only | Input | Section 1 and the phase tasks |
| 1 | CEO gate on v1.0 | Conditional go: 3 blockers, 10 majors, 10 minors | All applied in v1.1 (table below) |
| 1 | Technical verification on v1.0: every citation in sections 1, 3 and 4, half of 5 to 7, both migrations run on SQLite 3.49.1 over migrations 0001 to 0017 | 13 errors; both migrations applied clean; all other citations confirmed | All applied in v1.1 (table below) |
| 2 | CEO gate on v1.1 | Conditional go for V0: three text fixes first; later-phase items | All applied in v1.2 (second table below) |
| 2 | Technical verification on v1.1: the 13 errors re-checked, every new citation, both revised migrations re-run with the key, idempotency and dedupe cases | 11 fixed, 2 partly; 10 items still or newly wrong; SQL behaves as claimed | All applied in v1.2 (second table below) |
| 2 | Author's own check on v1.2 | Paths, dashes and both migrations re-validated after the last edit | Recorded at the end of this section |
| 3 | CEO gate on v1.2, confirmation only | **Go: V0 may start.** All 19 round 2 rows confirmed at the places they name | Its six non-blocking notes applied: section 10 production row, V0-1 stash and rehydration scope, V0-8 acceptance, the V2 promote wording, the V3-6b privacy check, and the one-PR rule for V2-1 with V2-1b and V3-1 with V3-1b |

Round 1 findings and where they landed:

| Finding | Landed in |
|---|---|
| The sync fix was under-scoped: a second mount-time dirty mark, and a conflict check that can never fire | V0-1 rewritten; V4-3 moved to follow V0; baseline row |
| The Oracle model fix could reach production without a live call | V0-2 promotion needs one live call; read-only outage check first |
| Soaks and log baselines measure nothing on an empty staging | Rule 2.1 scripted soaks; V0-7d soak script and health check; the V0 to V3 promote lines carry a minimum n; V4's gate is a CI budget, a test and owner checks |
| Findings save fails for a second account or domain (static ids as a global key) | New V0-8; V2 uses composite keys throughout |
| Non-Agency users pay a failed server call per chat message | New V0-9 |
| Server Oracle is Agency-only, so V3 would reach few users | Shared assembler for both chat paths; decision 1 has no default |
| Up-front identity resolution breaks the `/auth/link` no-upsert rule | V1-1 is a lazy per-request memo, with the extra fixtures |
| Skipping budget reads reverses a governance invariant; deferring the audit log risks a forked chain | V1-2 keeps both synchronous |
| The MCP handler has no execution context; the KV target was unreachable | V1-2 threads it; row 3's target is set by V1-0 |
| Quota includes a credit ledger; charge-after is unsafe | V1-4 is reserve then refund, with a unique ledger reason |
| The Agency gate is a regex; placement cannot exempt a route | `/runs` prefix; rule 2.1 "fail closed on gating" |
| Evidence ids unspecified; `fetcher='worker'` unprovable; save only at the end would lose findings; orphaned runs | Composite keys; V2 writes `client` only; three-step save; V2-10 sweeper |
| The critic filters on its verified flag, so "unreviewed" would drop every finding | V2-3 status field; acceptance asserts the count |
| Durable Objects cannot be listed, exported or deleted; V3-2 and V3-4 were unflagged | `oracle_conversations` table; V3-1b exports turns and clears indexed and legacy sessions; both tasks under `ORACLE_CONTEXT_ENABLED` |
| No account-link data move exists; account deletion skips audit and project data | V2-1b and V3-1b move this plan's tables only; the wider gap is recorded in 1.2, not fixed; deletion in V2-1, V3-1b; decision 9 |
| Overlap with `ai_answer_captures`, Zoro's tables and decision 8; weekly decision missing from context | `source_ref` instead of copies; verdict kept separate; weekly decision block |
| Salts and a Worker-set `prev` left Zoro's idempotency rule undefined | Both deferred (8.2); V5-1's hash is a pure function of stored rows |
| Release path conflict between AGENTS.md and Zoro 2.3 | Decision 8; rule 2.1 |
| Merkle tree, disclosure and receipts over-built for four findings | Deferred with a trigger (8.2) |
| The Worker cannot get a build SHA from the Vite config | V0-7 uses a deploy variable |
| "Do not extend the TTL" is impossible on KV | V0-4 puts the window number in the key |
| Limiter citation and values; branch state; bundle arithmetic | Baseline rows and V1-6, row 11 corrected |
| No scorecard row measured user flow | Rows 5 and 6 count wasted and repeated requests; row 14 times Run click to first finding and to report |
| The memory regex stores questions | V3-5 |
| Blockchain fit was scattered | Section 0.3 |
| V2-10 (MCP finding tools) was a no-op | Removed; noted in 1.2 |
| Untasked baseline rows (alerting, test-gated kill switch, dead-letter queue) | Partly: V0-7d adds a health check. The kill switch and the dead-letter consumer are recorded in 1.2 as not owned by this plan |
| D1 limits and body cap | Rule 2.1; caps in 5.1 |
| Acceptance criteria that could not be tested (latency row, promote lines, an either-or) | Row 14 and the promote lines restated; V3-8 has one behaviour |

Round 2 findings and where they landed:

| Finding | Landed in |
|---|---|
| After a sync conflict nothing refreshes in-memory state, and the conflict had no renderer until V1 | V0-1 (c): stash, rehydrate, inline notice |
| The stale-device push sends `force`, so a base version alone changes nothing; the base version needs its own field | V0-1 (b) |
| V0's "findings appear after a reload" check passes with the server save broken | V0 promote line uses `GET /api/findings` for two accounts |
| The status line claimed a round 2 record that was not there | This table |
| The soak script cannot run a browser audit; V0-7 was six deliverables | Rule 2.1; V0-7a to V0-7e; V1-6 acceptance |
| The client does not know the plan before the quota response | V0-9 awaits the in-flight quota; V4-2 keeps the request at start |
| The identity memo belongs in `identify()` itself; no task delivered "one plan read" | V1-1 files and scope |
| "The audit chain verifies after 50 concurrent calls" fails on untouched code | V1-2 acceptance is an ordering test |
| Memory tasks were Worker-only, so the browser path never used hosted facts | V3-6b |
| Conversation turns were not exported; legacy sessions were undeletable; re-keying the index would orphan the session objects | `object_name` column; 6.1; V3-1b |
| A session clear already exists | Baseline row; V3-1b needs a caller only |
| The account-link move contradicted Zoro P2-6 and its own acceptance | V2-1b scoped to this plan's tables, with a stated collision rule |
| A client could claim `fetcher='worker'` | V2-5 test |
| The 141-statement count was wrong and may exceed the tier limit | 5.1: multi-row inserts, about 20 statements |
| V2-10 and V4-3 omitted files they change; V4 was not frontend only; the shared body cap must not be raised | V2-10 files; V4 heading; V4-3 |
| The fallback and server-computed hash forms need different versions; `prev` had no reader | V5-1 uses v1 and v2; `prev` moved to V5-4 |
| A shell substitution in `package.json` does not expand on Windows | V0-7a node wrapper |
| "No foreign keys, matching the rest of the schema" was false | 5.2 bullet |
| The release rule gave a default and forbade acting on it | 2.1; decision 8 |

Author's check on v1.2: every cited path exists and every file marked new does not; no em dashes; both migrations applied over migrations 0001 to 0017 on SQLite 3.49.1 and the key, idempotency and dedupe cases behaved as the bullets in 5.2 and 6.2 state.

---

## 15. Execution log

Empty. The V0-7 baseline is recorded here, with its sample size, when measured:

| Measure | Staging (n) | Staging p50 / p95 | Production (n) | Production p50 / p95 |
|---|---|---|---|---|
| `/oracle/chat` first token | | | | |
| `/providers/*` | | | | |
| `/findings/bulk` | | | | |
| `PUT /workspace` | | | | |
| MCP `tools/call` | | | | |
| Error rate, all API routes | | | | |
| JS before first interaction (gzip) | | | | |
| Workspace payload bytes | | | | |
| Provider calls per Instant Audit | | | | |
| `oracle_chat` runs stuck `running` | | | | |
| Storage operations, scorecard rows 1 to 3 (from V1-0) | | | | |
