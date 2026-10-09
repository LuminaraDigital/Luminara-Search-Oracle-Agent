# Business Brain and Agent Crew: master ship plan (Track BB)

**Status:** v1.0 draft. Review round 1 pending (section 18). No code written. Nothing in this plan is approved until the owner answers section 3.  
**Date:** 2026-10-10  
**Owner:** Luminara Digital (owner gate before every production step)  
**Baseline:** `88547dc` (`HEAD` = `origin/main` = `origin/staging`), plus uncommitted work by another session listed in 1.3. Line numbers are working-tree numbers.  
**Sources:** the owner's brief of 2026-10-10 (AI at the foundation, agents do the work, business brain, founder community, desktop specialisation); three lists of reference projects supplied by the owner (section 13); eight read-only audits run on 2026-10-10 (backend and data, AI and agents, blockchain and payments, front end and desktop, deploy and security, existing plans, reference links and licences, platform facts).  
**Companions (binding):** [`weekly-decision-loop-10x-ship.md`](./weekly-decision-loop-10x-ship.md) (product spine), [`zoro-concepts-implementation-plan.md`](./zoro-concepts-implementation-plan.md) (its section 2 rules bind this plan), [`verifiable-flow-memory-10x-ship.md`](./verifiable-flow-memory-10x-ship.md) (V0 to V6), [`allora-concepts-implementation-plan.md`](./allora-concepts-implementation-plan.md) (CL0 to CL2 retest loop), [`oracle-operations-layer-additive-plan.md`](./oracle-operations-layer-additive-plan.md) (F1 to F4), [`trust-network-additive-plan.md`](./trust-network-additive-plan.md) (TN0 to TN8), [`lora-jetton-production-ship.md`](./lora-jetton-production-ship.md) (J1 to J7), `specs/0009-referrals-and-retention.md`, `specs/0015-smb-launchpad.md`, `specs/0016-agent-passport.md`, `specs/0017-trust-receipts.md`, APS invariants in `AGENTS.md`.  
**Draft input, not a decision:** `docs/plans/gamified-builder-ecosystem-tma-plan.md` (untracked, written by another session on 2026-10-10). Section 12 lists what this plan takes from it and what it corrects.

---

## 0. Verdict

### 0.1 What was asked

One product where a founder signs in and AI agents do the work: they audit, research, draft fixes, re-check and report, and every job ends in a result. It holds the founder's ideas and business data in one place (the business brain, including Google Analytics and Search Console), it replaces buying those services from freelancers, it is a place founders want to return to and meet each other, and the desktop app does what only a desktop can.

### 0.2 What the audits found

Five facts decide the shape of this plan.

1. **There is no agent crew yet.** The six "agents" in an Instant Audit are deterministic TypeScript; the only model call is one free-form report whose output nothing checks. The whole audit runs in the browser tab and stops when it closes. The server queue returns an empty shell. (1.1, rows A1 to A4.)
2. **Most of the vision already has an approved design that was never built.** Server-side audits (V6), the run ledger (V2), scoped memory (V3), the retest loop (CL1 to CL2), the approvals desk and containment (F1 to F4), agent spending sessions (K1 to K6), signed receipts, public profiles, the proof feed, first-party agent jobs and gated groups (TN1 to TN8). This plan sequences those and specifies only what is missing.
3. **Parts of the brief contradict decisions the owner already locked.** A visible points balance, daily check-ins, scheduled bot nudges, leaderboards, a marketplace between users, Stars escrow and a second on-chain contract are each rejected or deferred in a shipped spec or an approved plan. Nothing is overridden silently: each is a numbered owner decision in section 3 with a recommended default.
4. **Money and honesty defects are on `main` now.** The Jetton payment verifier checks the wrong opcode while the checkout switch is on; the paywall advertises a burn that never happens; one route can mint a "verified" receipt from hard-coded evidence; four paths can show a user a number no measurement produced. Phase BB0 fixes them before any feature work.
5. **Scale is tiny and staging cannot sign in.** Production held 5 user rows on 2026-10-01 (Zoro section 15). Staging has no bot and no Firebase configuration, so no signed-in flow can be tested before production. Community features are sequenced after the crew gives one founder a reason to stay, and each has a trigger, not a date.

### 0.3 The product in one picture

```
 Founder (Telegram Mini App, web, desktop)            Other agents (MCP)
        |  signs in, approves, reads results                 |
        v                                                    v
 +------------------------------------------------------------------+
 | Crew: Auditor, Scout, Fixer, Coach        (BB2, BB4)             |
 |   recipes run as durable steps; typed outputs; number guard;     |
 |   budget cap per run; approval before any external write         |
 +-----------+----------------------+-------------------+-----------+
             | reads                | writes            | proves
             v                      v                   v
 +---------------------+  +--------------------+  +------------------+
 | Business Brain      |  | Work               |  | Proof            |
 | project context,    |  | findings, Fix list,|  | run ledger,      |
 | typed facts, ideas, |  | prepared assets,   |  | evidence rows,   |
 | decisions, measured |  | reports, ship      |  | signed receipts  |
 | Google data (BB3)   |  | notes (BB1)        |  | (V2, TN1)        |
 +---------------------+  +--------------------+  +------------------+
             ^                      ^                   ^
             +----------- Community (BB5): ladder, project pages,
                          proof feed, gated builders chat. Built only
                          from server-attested events.
```

The Weekly Decision Loop stays the spine (audit, one Weekly Decision Card, Prepare, retest). The crew automates each stage of it. The locked category, "cost-displacement + AI adoption without rebuild", already describes replacing bought services with agents.

### 0.4 The brief, item by item

| Asked for | Decision | Lands in |
|---|---|---|
| Agents do the work, not assist | **Build.** Server-side recipes on Cloudflare Workflows, each ending in a deliverable and an honest status | BB2 (this is V6, specified) |
| Always a result | **Adapt.** Every run ends in a terminal state with a deliverable. "Not measured" is a valid result; an empty shell or an invented number is not | BB2 |
| Fewer invented numbers | **Build.** Typed outputs with one retry, a blocking number guard, evidence refs on every model claim | BB0 (stopgaps), BB2 |
| Business brain: one place for ideas and data | **Build as a read model.** The brain is the existing typed tables plus sourced facts and measured Google data. No second copy of the data | BB1 (timeline), BB3 |
| Google Analytics and more | **Build.** Search Console and GA4 read-only connections, aggregates only, tokens encrypted at rest. Google verification is a long-lead owner task | BB3 |
| Fix list from audit findings | **Build.** A board over `audit_findings`, with status history and a server re-check | BB1, BB2 |
| "What I shipped today" notes | **Build.** Private first; public only through the proof feed | BB1, BB5 |
| Approvals before consequential actions | **Take.** Sign-off Desk (F1) plus Telegram approve and deny buttons | BB1 |
| Named agent roster in Telegram | **Build.** Four named agents with real last-run state and threads; a per-founder coordinator | BB4 |
| Replace freelancer marketplaces for our categories | **Take.** First-party Agent Jobs (TN6): fixed price, deterministic acceptance checks, full refund on a failed check. Luminara is the seller | BB4 |
| Marketplace between users, human bounties, escrow | **Stay deferred** (TN decisions D4, D5). Stars cannot be paid out to a third party (1.2) | Parked (10.3) |
| Quests, streaks, builder ladder | **Adapt.** Server-proven quests and a ladder derived from signed receipts. No spendable points, no reward for a bare check-in | BB1 (finding-linked mission), BB5 |
| XP balance, daily check-in, leaderboards | **Owner decision.** Each is rejected or on hold in `specs/0009`. Recommended: no balance, no check-in reward, leaderboard only after a trigger | Section 3, decisions 5 to 7 |
| Role-gated Telegram chat | **Take** TN8's gated groups, earlier than TN decision D6 allows if the owner agrees | BB5a |
| Project pages and Demo Day | **Take** TN3 profiles with project fields; Demo Day as recognition only, no prize pool | BB5 |
| TON badges and wallet sign-in | **Adapt.** Badges are signed receipts first; a wallet links to an account by `ton_proof`. An on-chain badge is a testnet pilot behind a new owner decision | BB5, BB6 |
| Community voting, one person one vote | **Adapt.** One account one vote, advisory, eligibility by a verified ship or a paid plan | BB5 |
| Paid bounties in chat | **Parked** with reopen conditions | 10.3 |
| Desktop specialisation | **Build later.** Local file ingestion, native approval notices, a local runner for jobs that need the founder's own browser session. Code signing first | BB6 |
| Public playbook library | **Build.** Static pages from the compiled playbooks, linked from findings. Licence check first | BB1 (parallel lane) |

### 0.5 Phases

| Phase | Ships | Migration (by name) | Main flags | State |
|---|---|---|---|---|
| BB0 | Payment and honesty defects fixed; releases made safe; staging can sign in | none | none | Work order |
| BB1 | Fix list, ship notes, approvals inbox, attention feed, brain timeline, playbook pages | `fix_list_ship_notes` | `FIX_LIST`, `SIGNOFF_DESK`, `BEACON` | Work order |
| BB2 | Server-side crew: durable runs, typed outputs, number guard, run budget, server re-check | `crew_runs` (after V2's `run_ledger`) | `CREW_SERVER_RUNS` | Work order after BB2-0 re-baseline |
| BB3 | Business Brain: sourced facts, Search Console and GA4 connections, measured data in every prompt | `brain_connectors` (after V3's `scoped_memory`) | `BRAIN_RECORDS`, `CONNECTORS_GOOGLE` | Specified; starts with a re-baseline |
| BB4 | Crew in Telegram, roster, Agent Jobs on Stars, scheduled runs | `agent_jobs_notify` | `CREW_TELEGRAM`, `AGENT_JOBS_ENABLED`, `CREW_SCHEDULES` | Specified; starts with a re-baseline |
| BB5 | Community: ladder, quests, project pages, proof feed, gated builders chat, polls | named at re-baseline | per feature | Design, decision-gated |
| BB6 | Desktop runner, wallet link, on-chain badge pilot | named at re-baseline | per feature | Design, decision-gated |

### 0.6 Launch cut

"MVP launch with an ecosystem people can join" means, in this plan: **BB0, BB1, BB2 and BB5a** (one gated builders chat plus the invite link that already exists). At that point a new founder can sign in, have the crew audit a site with the tab closed, work a Fix list, see what changed, and join a builders chat by doing real work. BB3 and BB4 follow in that order. BB5a needs owner decision 8; without it the launch cut is BB0 to BB2.

### 0.7 Locked non-goals

Inherited and unchanged: every non-goal in Zoro 0.2, verifiable-flow 0.6, Allora 0.3, trust-network 0.4 and oracle-ops section 13; LORA rules J1 to J7.

Added by this plan:

- No points, rank or balance that can be bought, spent, transferred or converted to LORA or anything else. No reward for opening the app.
- No conversion path from any in-app progress to a token, now or later. LORA is not used by any feature in this plan.
- Luminara never holds or releases funds between two users, on Stars, TON or any Jetton.
- No agent publishes to a third-party system without a single-use, argument-bound approval (F1), and none at all while its run is sealed (F3).
- No figure reaches a user from a model unless a measured evidence row or a connector snapshot contains it.
- No daily or weekly bot message a user did not opt in to. No broadcast to all users.
- No copy of code from a project whose licence does not allow it (section 13). Patterns only, written independently.
- No router rewrite of `worker/index.ts` and no state-library migration of `App.tsx` (verifiable-flow 0.6). BB1-1 adds a view table; it is not a router.

### 0.8 What "ready" means here

BB0 and BB1 are specified to task level against code that was read on 2026-10-10 and are a work order once section 3's first group is answered. BB2 is specified to task level and waits on its re-baseline (BB2-0), because five of its prerequisites belong to other plans and none has merged. BB3 and BB4 are specified to task level; each starts with a re-baseline that re-checks every citation. BB5 and BB6 are designs with triggers, not work orders.

This plan is ready for production in the sense the sibling plans use: every phase has gates, flags, a release path, a rollback and promotion criteria. It is not a claim that the product is ready. No code exists for any of it.

---

## 1. Baseline (2026-10-10)

### 1.1 Verified by reading the code

Rows marked **D** were re-read directly while writing this plan. The rest come from the specialist audits and are re-checked by the verifier in review round 1.

| # | Area | Finding | Evidence |
|---|---|---|---|
| A1 | Where an audit runs **D** | Entirely in the browser: a nine-node in-memory graph, then one model call for the report. Closing the tab ends it. | `components/audit/InstantAuditView.tsx:245-454`, `services/agentCore/crewOrchestrator.ts:271`, `services/agentCore/stateGraph.ts:27` |
| A2 | The "crew" | All six agents are deterministic: templates, substring matches, and a score of 85 minus penalties. No agent calls a model. | `services/agentCore/agents/playbookAuditorAgent.ts:75-163`, `serpRadarAgent.ts:46-140`, `criticReflectionEngine.ts:50-82` |
| A3 | Server queue path **D** | `POST /audit/run` is Agency-gated and has no UI caller. Without a project it returns a `not_measured` shell with code `AUDIT_V1_MINIMAL`. The consumer catches its own errors, so `max_retries` never applies. | `worker/index.ts:1806`, `worker/auditQueue.ts:263-267`, `:297-319` |
| A4 | Server Oracle **D** | One Groq streaming call with no `tools` field, on a model a repo comment says was shut down on 2026-08-16. The Durable Object stores 80 chat turns and nothing else. No alarm exists anywhere in `worker/`. | `worker/oracleChat.ts:267`, `services/llm/nativeModelDefaults.ts:6`, `worker/oracleSession.ts` |
| A5 | Structured output | No schema library is a dependency. Model JSON is parsed with a silent fallback and never retried. Idea Scout and the browse loop have hand-written validators. | `package.json`, `services/llm/safeJsonParse.ts:6-43`, `services/ideaScout/rules.ts:348-378` |
| A6 | Budgets | Only paid research tools are metered, at a flat 1 cent. Model tokens never reach `cost_events`. Subscribers have no daily cap. | `worker/budgets.ts:36`, `worker/quotaMiddleware.ts:138` |
| H1 | Invented number: dossier **D** | The downloadable dossier prints a hard-coded `overallScore: 88`. | `components/audit/ReportDisplay.tsx:176`, `services/reports/portableDossierService.ts:268` |
| H2 | Invented numbers: report prompt **D** | The prompt asks the model for "Expected Impact", "Est. Organic Rank" and "Trust Signal Strength" columns; the output is rendered unchecked. | `services/geminiService.ts:841-846` |
| H3 | Invented numbers: Telegram chat **D** | The bot is told to "deliver an Instant Scout diagnostic" for any domain with no fetch, at temperature 0.7, with Business DNA interpolated unfenced and no output check. | `worker/telegramBot.ts:207`, `:851` |
| H4 | Fabricated receipt **D** | `POST /gateway/execute` returns hard-coded evidence (HTTP 200, the SHA-256 of the empty string) and can issue a public `worker_verified` `domain_control` receipt with no domain check. Dormant only because `TRUST_RECEIPTS_ENABLED` is `"false"`. | `worker/oracleGateway.ts:122-124`, `:151-160`, `services/decision/fastDecisionService.ts:297` |
| H5 | Sentinel **D** | `cited` starts `true`, so a failed search reads as cited; the alert says "missing from top AI answers" from five web results; it passes the login id where reads use the billing id. | `worker/sentinel.ts:154`, `:212`, `:258` |
| P1 | Jetton opcode **D** | The verifier accepts only opcode `0x7362d096`. TEP-74 and the repo's own LORA contract use `0x7362d09c`. No real USDT or LORA transfer can match. The unit test builds its fixture from the same constant. | `worker/jettonSettlement.ts:27`, `contracts/jetton/contracts/messages.tact:36`, `contracts/jetton/tests/harness.ts:20` |
| P2 | Jetton switch **D** | `JETTON_CHECKOUT_LIVE = true` with a mainnet USDT master set. LORA rule J5 and spec 0018 say it stays off until a testnet payment is credited on staging; staging's merchant address is a placeholder. | `worker/tonPayment.ts:53`, `docs/plans/lora-jetton-production-ship.md` section 2 |
| P3 | Burn copy **D** | The paywall reads "29 LORA (15% Burn)" and "$LORA (Burn)". The contract does not burn; LORA rule J6 forbids the claim. | `components/paywall/PaywallModal.tsx:256-258`, `:278-280`, `:462` |
| P4 | Stars | A one-day SKU overwrites an active subscriber's plan. The failure refund targets the payload user id, not the payer. Zoro Phase 2 owns the fix and has not shipped. | `worker/telegramBot.ts:353`, `:381`, Zoro section 5 |
| M1 | Findings save **D** | The client-supplied finding id is a global primary key while the conflict clause covers `(account_id, domain, stable_key)`, so a second account saving the same rule finding fails. Fixed only on unmerged branches (CL0-1, V0-8). | `worker/findingsService.ts:166`, `:183` |
| M2 | Finding lifecycle | Four states exist and survive a re-audit. There is no status history, no shipped or verified time and no server re-check. The board lives in `sessionStorage`; `GET /findings` has no client caller. | `worker/findingsService.ts:11`, `services/audit/findingBoardService.ts:41`, `:52` |
| M3 | Memory | Two server stores: per-project context (MCP read and write) and per-account free-text facts. Neither records a source per record. Retrieval is keyword overlap over the newest 50 facts; no vector index is bound. Chat auto-stores regex matches at confidence 0.72 with no review. | `worker/memoryRag.ts:264`, `:298`, `:309`, `worker/projectContextService.ts` |
| M4 | Connectors | No OAuth client to any third party. `gsc_oauth_tokens` and `GOOGLE_OAUTH_CLIENT_ID` are names with no reader. Search Console is a CSV parsed in the browser. No server-side encryption helper exists. | `migrations/0005_visibility_agent_platform.sql:72-77`, `components/audit/GscPanel.tsx:25-42` |
| M5 | Missions | Weekly. One mission is server-proven by a one-time receipt; `view_delta` and `checklist_fix` are client-claimed and not tied to a finding. The committed rule is "There is no coin balance". | `services/referrals/rules.ts:22-41`, `worker/referrals.ts:569-584`, `specs/0009-referrals-and-retention.md` |
| G1 | Approvals **D** | `mcp_action_requests` and approve and deny routes exist with no client. An approval is reusable for 30 minutes and is not bound to the arguments. The bot subscribes to `callback_query` and never handles it. | `worker/index.ts:1543-1557`, `worker/mcpGovernance.ts:108`, `:214`, `worker/telegramBot.ts:290` |
| R1 | Privacy **D** | Account deletion skips `audit_findings`, `audit_runs`, `projects`, `agent_reports`, `shared_reports`, `api_keys` and all KV and Durable Object state. Export files are written to the installer bucket and never deleted. Account linking updates `users` only, so the losing account's rows are orphaned. | `worker/privacyService.ts:176-204`, `:267-269`, `worker/userStore.ts:333-336` |
| R2 | Deploy pipeline **D** | Migrations auto-apply for both environments with no backup or bookmark step. The production job has no `needs:` on staging and no `concurrency`. A manual dispatch of "staging" from `main` also deploys production. | `.github/workflows/deploy-cloudflare.yml:28`, `:67`, `:90`, `:129` |
| R3 | Smoke lists **D** | `REQUIRED_D1_MIGRATIONS` stops at 0017; no table from 0018 or 0020 is required. | `scripts/smoke-check.mjs:23-36` |
| R4 | Scheduled and queue dispatch **D** | An unmapped cron expression runs every job (a documented choice). `queue()` sends every batch to the audit consumer regardless of queue name. | `worker/scheduledJobs.ts`, `worker/index.ts:2059-2071` |
| R5 | App Check | Production sets `REQUIRE_APP_CHECK` to `"true"`; the client reads its site key only from a build-time variable that no tracked env file or workflow step sets. Whether production sign-in works is not verified (1.4). | `services/auth/firebaseAppCheck.ts:24`, `wrangler.jsonc` production vars |
| R6 | Staging | Staging has no Firebase web key or project number and no bot token, so no signed-in test is possible. | `wrangler.jsonc` staging vars, Zoro section 10 |
| U1 | App shell | One hand-rolled router in a 1,913-line `App.tsx` with 32 views; adding a view touches about eight files. | `App.tsx`, `types.ts:9-42`, `services/telegram/startParam.ts:22-48` |
| U2 | Telegram Mini App | Uses initData auth, BackButton, haptics, theme, Stars `openInvoice` and link share. MainButton is wrapped and never called. Write access, prepared-message share, story share and home screen are unused. | `services/telegram/tma.ts:290`, `:358-427` |
| U3 | Desktop | A thin Electron window on the hosted site with an eight-method bridge. Its only desktop-only power is calling a local Ollama and a crawler the user starts by hand. Installers are documented as unsigned. | `electron/main.cjs:17-86`, `electron/preload.cjs:8-22`, `docs/desktop-distribution.md` |
| C1 | Chain state | Nothing Luminara-authored is recorded as deployed on any network. `CitationRegistry.tolk` is an untested digest registry driven by a hot key; it is not a badge contract and its Worker client cannot sign. TON Connect is used only to pay: no `ton_proof`, no wallet table. | `contracts/jetton/deployments.json`, `contracts/ton/contracts/CitationRegistry.tolk`, `worker/chain/ton/citationRegistry.ts:117-163` |

### 1.2 Platform facts that constrain the design

Loaded from primary documentation on 2026-10-10. Each deserves one manual spot-check at the phase re-baseline that depends on it.

| Fact | Consequence | Source |
|---|---|---|
| Cloudflare Workflows is generally available: durable steps with retries, `step.sleep`, and `step.waitForEvent` (1 second to 365 days). Paid limits: 10,000 steps per instance, 1 MiB per step result, 30 s CPU per step. Steps are billed ($0.80 per 100,000 after 500,000 a month). The `workflows` key is not inherited by environments. | Workflows is the step runner for BB2. Large payloads are stored and passed by reference. The binding is declared in all three blocks with per-environment names. | developers.cloudflare.com/workflows/reference/limits/, /workflows/reference/pricing/, /workers/wrangler/configuration/ |
| A Durable Object alarm is at-least-once, one per object, 15 minutes wall time. Durable Object bindings are not inherited; the `migrations` tag list is. A Worker uses either `migrations` or the newer `exports` map, not both. | A per-founder coordinator (BB4) is one new SQLite class with one appended tag at top level and a binding in all three blocks. This Worker stays on `migrations`. | developers.cloudflare.com/durable-objects/platform/limits/, /durable-objects/reference/durable-objects-migrations/ |
| The Agents SDK (npm `agents`, MIT, v0.28.0 on 2026-10-09) is a Durable Object subclass with per-agent SQLite, `schedule()`, and a Workflows bridge with `waitForApproval`. It is pre-1.0. | Adopt only behind one adapter file and only if the BB4-0 spike passes. The approval record stays `mcp_action_requests`; the SDK's own approval state is not used. | developers.cloudflare.com/agents/, github.com/cloudflare/agents |
| D1: 10 GB per database, 2 MB per row, 100 bound parameters per statement, 1,000 queries per invocation on Paid, 50 on Free. A remote export blocks other requests. | Page text and deliverables go to R2, not D1. Batch endpoints state a statement cap. Backups are taken off-peak. | developers.cloudflare.com/d1/platform/limits/ |
| Workers AI JSON mode cannot stream and "can't guarantee" schema conformance. AI Gateway guardrails do not support streamed responses and its rate limits are per gateway. | Typed output is validated and retried in the Worker. Per-account limits stay in the Worker. | developers.cloudflare.com/workers-ai/features/json-mode/, /ai-gateway/features/guardrails/usage-considerations/ |
| Vectorize: dimensions are fixed at creation; a metadata index must exist before vectors are inserted; 50,000 namespaces per index on Paid. | If the owner approves a vector index (decision 13) it is created once with a 1,024-dimension model and an `accountId` metadata index, and a hash vector is never written to it. | developers.cloudflare.com/vectorize/platform/limits/ |
| Telegram: "Payments for digital goods and services must be carried out exclusively in Telegram Stars" inside Telegram apps. | Inside the bot and Mini App, plans and jobs are sold in Stars only. TON and Jetton checkout may appear only on web and desktop (decision 9). | core.telegram.org/bots/payments-stars, telegram.org/tos/bot-developers |
| No Bot API method sends Stars from a bot to a user. The outflows are `refundStarPayment` (whole charge, to the payer), paid broadcasts and gifts. Star revenue may be held up to 21 days. | Escrow, payouts to builders and a retained fee cannot be built on Stars. Full refund on a failed acceptance check can. | core.telegram.org/bots/api, telegram.org/tos/stars |
| A bot cannot start a conversation. Mini App `requestWriteAccess` asks permission. About 30 messages a second overall, one a second per chat. | Every outbound message needs a prior start or a granted write access, an outbound pacing rule and 429 handling. | core.telegram.org/bots/faq, core.telegram.org/bots/webapps |
| Gated chats: `createChatInviteLink` with `creates_join_request`, `approveChatJoinRequest`, `chat_join_request` updates; the bot needs `can_invite_users`. A join requester can be messaged for 5 minutes. | BB5a approves join requests from a server-side rule. The webhook must subscribe to `chat_join_request`. | core.telegram.org/bots/api |
| Mini Apps with crypto features must be TON-only and use TON Connect. | No non-TON asset is promoted in the Mini App. | core.telegram.org/bots/blockchain-guidelines |
| Google: read-only GA4 and Search Console scopes exist (`analytics.readonly`, `webmasters.readonly`). An unverified app is capped at 100 users for the life of the project; an app in Testing status gets refresh tokens that expire in 7 days. Verification needs a privacy policy on a verified domain and a demo video. | Verification is a long-lead owner task (BB3-0). Until it completes, connections are for the owner's own accounts on staging. | support.google.com/cloud/answer/15549945, /answer/13464321 |
| Google Limited Use: data may be used only for user-facing features, transferred only with consent, and not read by humans except in listed cases. Google's verification FAQ adds that user data "may not be used to train or improve foundational or frontier models". | Connector data is stored as aggregates, sent only to model providers with no-training terms, and never used for training. | developers.google.com/terms/api-services-user-data-policy, support.google.com/cloud/answer/13463817 |
| TEP-85 soulbound tokens are items under a TEP-62 collection; in the standard collection only the collection owner can mint. `ton_proof` does not bind the network. | An on-chain badge needs the owner's wallet as collection owner (LORA rule J1 forbids an agent key). The wallet link checks the network separately. | github.com/ton-blockchain/TEPs (0085, 0062), docs.ton.org/applications/ton-connect/how-to/ton-proof |

### 1.3 Uncommitted work by another session (not in `88547dc`)

Seven modified files and four untracked ones. This plan does not build on them and does not edit them.

| Work | What it adds | Why it cannot merge as written |
|---|---|---|
| Lumens points and ranks (`services/referrals/rules.ts`, `worker/referrals.ts`) | A points total, five ranks, 25 points for a daily check-in at `POST /referrals/checkin` | It is the "visible coin balance" and tap-to-earn that `specs/0009` rejects. Unspent credits add points, so using a credit lowers the total. Needs decision 5 and a new spec first. |
| Community feed (`worker/ideaScout.ts`) | A feed, share and vote stored in one KV value | Seed cards carry invented upvote counts. Share loads an idea by id with no account filter, so one account can publish another's card. Votes record no voter. The feed stores account ids. One KV value is read-modify-write. No privacy export or delete. |
| Workers AI fallback (`worker/providerRelay.ts`, `worker/workersAiFallback.ts`, `wrangler.jsonc`, `worker/env.ts`) | An `ai` binding in all three blocks and a chat fallback to an 8B model | It also falls back on any non-OK upstream, including a 4xx, after quota is charged. It ignores `response_format` and `tools`, so a typed request degrades silently. It is unmetered. It answers verifiable-flow decision 3, whose default is No. |

BB0-18 records the conditions under which each may merge. The owner decides who makes the changes.

### 1.4 Not verified (each is resolved by a named task)

- Whether production serves `88547dc`, and so whether P1 to P3 are live (BB0-0).
- Whether production sign-in works with App Check required (BB0-11, an owner check).
- The Workers plan tier, which sets D1 queries per invocation and whether Workflows is usable (BB0-19).
- Remote D1 migration state for 0018 to 0020 on both databases (BB0-13).
- Which hosted model keys exist per environment, and whether Groq still serves the Oracle's model (BB0-9, BB2-0).
- How Google classifies the two read-only scopes; the label is shown only in the Cloud Console (BB3-0).
- Whether the `agents` package runs under this Worker's compatibility date and `migrations` configuration (BB4-0).
- Mainnet cost of minting a badge item (BB6 re-baseline).
- The licence of the vendored playbook sources, before any public page is generated from them (BB1-10).

---

## 2. Rules for every task

### 2.1 Inherited

Zoro section 2 applies in full: gates (2.1), flags (2.2), release procedure (2.3), rollback (2.4), migration rules (2.5), privacy rule (2.6), double-check protocol (2.7), licence keys (2.8). Verifiable-flow 2.1 and 2.3 apply. Oracle-ops section 12 (release checklist) and its one-flag-per-production-release rule apply. Read them before the first task.

### 2.2 Deltas from the 2026-10-10 audits

- **Branch from `origin/staging`.** Local `staging` is 91 commits behind. Never commit on `main`.
- **Shared tree.** Other sessions work in this checkout. Stage only your own files; never `git add -A`; re-run `git status --short` before finishing a task. Migration and spec numbers are assigned at PR time; the next free numbers today are migration 0021 and spec 0019. This plan names its migrations.
- **Every binding in three places.** A new KV, D1, R2, queue, Workflows or Durable Object binding is declared in the top-level block, `env.staging` and `env.production`. BB0-16 makes CI fail when one is missing. A Durable Object tag is appended once, at top level.
- **Every cron mapped.** A new cron expression is added to `wrangler.jsonc` and to `CRON_JOBS` in `worker/scheduledJobs.ts` in the same PR. BB0-15 adds a test that fails on an unmapped expression.
- **Every route protected.** The route guard is default-allow. A new route gets its own prefix and an entry in `PROTECTED_API_ROUTES` (`worker/authMiddleware.ts:151`), and an explicit dual rate limit if it costs money.
- **Every account-keyed table registered.** A new table with an account key is added to the account table registry (BB0-17) in the PR that creates it, which gives it export, delete and account-link handling together.
- **Resources before deploy.** A queue, bucket, Workflows class or secret is created by an operator on staging, then production, before the PR that references it merges. A CI dry-run does not prove a resource exists.
- **Bodies are capped.** New handlers read through `readBody` with a stated cap. No handler calls `request.json()` directly.
- **Soaks are scripted.** Staging has no users. A soak means the flag on in staging, a script driving the Worker, and a report with n, p50, p95 and errors attached to the promotion PR.
- **No em dashes** in new copy (`AGENTS.md`).

### 2.3 Flags added by this plan

All use `worker/featureFlags.ts` once oracle-ops Phase 0 item 8 lands (BB0-13): unset means off, a KV override gives a kill switch without a redeploy, and an account allowlist gives a canary. Each is declared in all three `vars` blocks and typed in `worker/env.ts`.

| Flag | Phase | Values | Off means |
|---|---|---|---|
| `FIX_LIST` | BB1 | off, on | Finding status changes write no history; ship-note routes return 404; the view is hidden |
| `SIGNOFF_DESK`, `BEACON` | BB1 | per oracle-ops section 8 | Per oracle-ops |
| `CREW_SERVER_RUNS` | BB2 | off, on | `/crew/*` returns 503 `CREW_DISABLED`; Instant Audit runs in the browser as today |
| `BRAIN_RECORDS` | BB3 | off, on | Facts behave as today: no proposals, no review queue |
| `CONNECTORS_GOOGLE` | BB3 | off, on | `/connectors/*` returns 404; no sync job runs; stored tokens are not refreshed |
| `CREW_TELEGRAM` | BB4 | off, on | Telegram free text uses today's chat path; no coordinator object is created |
| `AGENT_JOBS_ENABLED` | BB4 | off, on | Catalog hidden; invoice creation and pre-checkout refuse a `job:` payload |
| `CREW_SCHEDULES` | BB4 | off, on | No scheduled run is created |

### 2.4 Execution loop

Every task runs the same loop. It is the working form of "specialist agents, a verifier and a CEO gate".

1. **Re-baseline (read-only).** Re-read the cited lines; correct this plan first if the code moved.
2. **Implement** on a branch from `origin/staging`, in a worktree, by the specialist named in the task's lane: FS (full-stack), AI (AI and machine learning), BC (blockchain and payments), OPS (deploy and security).
3. **Double-check** per verifiable-flow 2.3: acceptance test, typecheck, targeted tests, the regression grep named in the phase. A task is not done while a check is red.
4. **Independent review** by an agent that did not write the code, plus a verifier that re-checks every `file:line` in the PR description and runs any SQL on a database built from the real migrations.
5. **Fix and re-review** until the reviewer has no blocker.
6. **Phase gate.** A CEO-level reviewer reads the phase's promotion evidence and returns go or no-go. No-go findings are fixed and the gate is re-run.
7. **Owner approval** in chat before any production step. New flags reach production off; turning one on is its own one-line PR.

---

## 3. Owner decisions

Nothing below is assumed. "Default" is what the plan does if the owner does not answer.

**Needed before BB0 and BB1**

| # | Decision | Recommended | Default if no answer |
|---|---|---|---|
| 1 | Approve this track, its phase order and the launch cut in 0.6 | Yes | None; needs a yes |
| 2 | Confirm in your own wallet app that `TON_RECEIVING_ADDRESS` (`UQC2...176T`) is yours (LORA open action O1) | Confirm | TON checkout stays hidden |
| 3 | The other session's uncommitted work (1.3): hold until the conditions in BB0-18 are met | Hold | Held; this plan does not touch it |
| 4 | Release path (verifiable-flow decision 8) and full account deletion (verifiable-flow decision 9) | PR from `staging` to `main`; yes to full deletion | As verifiable-flow defaults |

**Needed before BB1 ships to production**

| # | Decision | Recommended | Default if no answer |
|---|---|---|---|
| 5 | Points. `specs/0009` rejects a visible balance and tap-to-earn. | Keep the rule. Show progress as counts of server-attested events and a ladder level. Do not ship Lumens. If the owner wants XP anyway, it needs a new spec that supersedes 0009 Decision 3 and keeps XP unpurchasable, unspendable and unconvertible. | No points |
| 6 | Daily streak and check-in reward | Keep the weekly streak. A day with a ship note lights a calendar strip and earns nothing. | Weekly streak only |
| 7 | Bot messages. `specs/0009` Decision 6 says the cron sends no mission nudges; Allora decision 4 and oracle-ops F2 each propose a narrow push. | One send policy for all three: opt-in; transactional notices only (an approval you triggered, a job or retest result); at most 5 a day; one optional weekly brief the user turns on. No nudge to return. | No messages except replies |

**Needed before BB2**

| # | Decision | Recommended | Default if no answer |
|---|---|---|---|
| 8 | Gated builders chat at launch. TN decision D6 parks groups until 50 verified profiles. | Un-park one chat with the entry rule in 9.2. | Parked; launch cut is BB0 to BB2 |
| 9 | Selling inside Telegram in Stars only; TON and Jetton options shown only on web and desktop | Yes. It is Telegram's rule (1.2). | Yes |
| 10 | Server-side audits with hosted model keys (verifiable-flow decision 5), for which plans (decision 1 there), and hosted keys on staging (Zoro decision 9) | Yes. Every signed-in plan gets server runs inside a per-run cost cap and a weekly run count. | BB2 does not start |
| 11 | Per-run cost caps and weekly run counts per plan | Set from BB2-0's measured token use. Starting proposal to test: Free 1 run a week on 1 domain; Starter 5; Growth 20; Agency 60. | BB2-0 proposes; no production flag until answered |
| 12 | Merge oracle-ops F4 Agent Seats into spec 0016 K1 (TN decision D2) | Yes, before either is built | BB4 does not start |

**Needed before BB3 to BB6**

| # | Decision | Recommended | Default if no answer |
|---|---|---|---|
| 13 | Bind Workers AI and a Vectorize index (verifiable-flow decision 3) | No for now. Typed, project-scoped retrieval first; revisit after BB3 with measured recall. | No |
| 14 | Start Google OAuth verification; approve the privacy-page sentence and the Limited Use disclosure | Start now; it takes weeks | BB3 ships to staging only |
| 15 | Agent Jobs catalog, Star prices, and how many jobs each plan includes | Three jobs first (8.4). Prices proposed in BB4-0 from measured run cost. | Staging-only nominal prices |
| 16 | Narrow carve-out from oracle-ops "Watches are parked": scheduled runs of read-only recipes that write only to the founder's own account | Yes, after F3 is enforcing | No scheduled runs |
| 17 | Lift the social hold for a leaderboard and Builder of the Month | Not before 50 accounts have a verified ship in one month. Then a count-based board, opt-in. | On hold |
| 18 | Third-party marketplace and human bounties (TN decisions D4, D5) | Stay deferred | Deferred |
| 19 | On-chain badge pilot. It needs an amendment to Zoro 0.2 ("no custom contract") and zetachain 0.2. | Off-chain signed badges first. A testnet-only pilot later, deployed by the owner. | Not started |
| 20 | Desktop: buy a code-signing certificate; approve the local runner scope | Yes to signing before any new desktop capability | BB6 does not start |

Engineering decisions made in this plan, which the owner may override: Workflows as the step runner; `zod` as the schema library; a D1 lease on the daily cron for system schedules until BB4; the Agents SDK only behind an adapter and only if its spike passes; no AI Gateway in BB2.

---

## 4. Phase BB0 - Stop the bleeding, make releases safe

**Goal:** nothing on `main` takes money it cannot credit, shows a number nobody measured, or claims a verification nobody did; and a change can be tested signed-in on staging and released without a blind migration. No user-visible feature.

### 4.1 Tasks

| ID | Lane | Task | Files | Acceptance | Size |
|---|---|---|---|---|---|
| BB0-0 | OPS | Record what is deployed: `wrangler deployments list` for both environments against `git rev-parse origin/main`. Operator step. | this document | 1.4 first bullet answered. | S |
| BB0-1 | BC | Jetton verifier. Correct the notification opcode and set `JETTON_CHECKOUT_LIVE` to `false`. Add a test whose notification cell is built from the literal `0x7362d09c`, independent of the Worker constant. | `worker/jettonSettlement.ts:13,27`, `worker/tonPayment.ts:51,53`, `tests/jettonSettlement.test.ts`, `tests/paymentFailClosed.test.ts` | A standard notification decodes; one with `0x7362d096` does not. `POST /ton/invoice` with `asset:"USDT"` is refused. Native TON and Stars tests are unchanged. | S |
| BB0-2 | BC | Remove burn wording from the paywall and the public Q402 catalog. | `components/paywall/PaywallModal.tsx:256-258,278-280,462`, `worker/q402/facilitator.ts`, `worker/q402/middleware.ts` | `grep -ri "burn" components worker` returns only historical comments that state no burn occurs. | S |
| BB0-3 | BC | Remove the fabricated receipt and the hard-coded evidence from the gateway. Where no fetch happened the response says `not_measured`. If no caller remains, delete the route. | `worker/oracleGateway.ts:114-165`, `services/decision/fastDecisionService.ts:297`, `services/trust/brandPassport.ts:71-76` | No code path issues a `worker_verified` receipt without a verifier result (test). The passport matches the receipt subject to the domain. | S |
| BB0-4 | FS | Dossier score. Pass the real score or omit the badge. | `components/audit/ReportDisplay.tsx:176`, `services/reports/portableDossierService.ts:268` | A dossier for an audit with no measured score prints "Not measured". No literal score remains (grep). | S |
| BB0-5 | AI | Telegram chat. Add the cite-or-silence rule; remove the instruction to produce a diagnostic for a domain nobody fetched; fence Business DNA with `wrapUntrustedContent`; run the reply through `runAllValidators` and replace flagged spans before sending. | `worker/telegramBot.ts:181-283,837-915`, `worker/agentOutputValidators.ts:96-123`, `utils/untrustedContent.ts` | A fixture reply with an invented percentage is sent with "not measured" in its place. An instruction planted in Business DNA is not followed (recorded-output test). | M |
| BB0-6 | AI | Report prompt. Remove the three columns in H2 unless an evidence row supplies the value. Coordinate with V2-7, which replaces this prompt. | `services/geminiService.ts:841-846` | The honesty baseline count does not rise. A report from the fixture audit has no rank or impact column. | S |
| BB0-7 | AI | Sentinel. `cited` starts unknown; a failed search yields no alert; the alert names what was checked; writes use the billing id. | `worker/sentinel.ts:154-178,212,258,298` | With the search key unset no "missing" alert is sent. A linked account's enqueued run is readable by that account. | S |
| BB0-8 | BC | Stars correctness. Adopt Zoro Phase 2 (rank guard, scoped refund). Refund the payer, not the payload user. | `worker/telegramBot.ts:323-418,956-1009`, `worker/userStore.ts:235-248` | A subscriber who buys a one-day SKU keeps their plan and expiry. A failed ledger write refunds `successful_payment.from.id`. | M |
| BB0-9 | AI | Server Oracle model. Adopt verifiable-flow V0-2. | per V0-2 | Per V0-2. | S |
| BB0-10 | FS | Findings save. Adopt Allora CL0-1 (server-issued finding ids). | `worker/findingsService.ts:166,183` | Two accounts saving the same rule finding both succeed (test on `tests/helpers/sqliteD1.ts`). | S |
| BB0-11 | OPS | App Check. The owner signs in on the production web app with email. If it fails, inject the site key into both build steps as a GitHub Actions variable. | `.github/workflows/deploy-cloudflare.yml`, `services/auth/firebaseAppCheck.ts:24` | Owner confirms sign-in, sign-up and reset work on production. | S |
| BB0-12 | OPS | Staging can sign in. Zoro section 10 step 6 (a separate test bot) plus a staging Firebase configuration. Operator steps. | `wrangler.jsonc` staging vars | The owner signs in on staging through the test bot and on the web. | M |
| BB0-13 | OPS | Adopt oracle-ops Phase 0 items 5 to 10: smoke preflight between migrate and deploy, smoke lists through 0020, migration lint, production `needs:` staging with a required reviewer, `worker/featureFlags.ts`, the mapped 15-minute `ops_alerts` cron, remote migration state recorded. | per oracle-ops section 6 | Per oracle-ops Phase 0 exit. | L |
| BB0-14 | OPS | Deploy workflow. A dispatch deploys only the environment it names; add a `concurrency` group per environment; record the D1 Time Travel bookmark in the job log before each migrate. | `.github/workflows/deploy-cloudflare.yml:28,90,59-67,121-129` | Dispatching "staging" from `main` runs only the staging job (workflow test with `act` or a dry branch). Each deploy log shows a bookmark. | S |
| BB0-15 | OPS | Dispatch safety. A test fails when a `triggers.crons` entry is not in `CRON_JOBS`. `queue()` dispatches on `batch.queue` and rejects an unknown queue. The audit consumer rethrows retriable errors so `max_retries` applies; a dead-letter consumer marks the run failed. | `worker/scheduledJobs.ts`, `worker/index.ts:2059-2071`, `worker/auditQueue.ts:297-319`, `tests/scheduledJobs.test.ts` | Adding an unmapped cron fails CI. A message from an unknown queue is acknowledged and reported, not processed. A provider error is retried twice, then dead-lettered and marked failed. | M |
| BB0-16 | OPS | Binding parity. `validate-env` fails when a binding name appears in one block and not the other two. A feature whose binding is missing returns 503 `BINDING_MISSING`, never a silent fallback. | `scripts/validate-env.mjs`, `worker/env.ts`, `worker/memoryRag.ts:100-131` | Removing a binding from `env.staging` fails `npm run env:validate`. | S |
| BB0-17 | FS | Account table registry. One module lists every account-keyed table with its key column and its export, delete and link-move behaviour. Privacy export, deletion and the account-link move (verifiable-flow V2-1b's helper) iterate it. A test reads every migration and fails on a table with an `account_id` or `owner_account_id` column that is not registered or explicitly exempted. Deletion also removes the R2 export object, clears Oracle sessions and removes vectors. | new `worker/accountTables.ts`, `worker/privacyService.ts:46-212,267-273,427-443`, `worker/userStore.ts:292-345`, new `worker/accountLinkMove.ts` | After deleting an account no registered table holds its id and its export object is gone. After linking two accounts no registered table holds the losing id; collisions follow V2-1b's keep-the-later rule. Adding an unregistered account table fails CI. | L |
| BB0-18 | FS | Conditions for the uncommitted work (1.3), recorded here and sent to that session. Points: wait for decision 5. Feed: authenticate share and vote, filter share by account, one vote per account in D1, no seeded counts, no account ids in the response, D1 not one KV value, privacy registry entry. Fallback: only on network failure or 5xx, never on 4xx; refuse a request that carries `response_format` or `tools`; meter it; wait for decision 13. | this document | The other session or the owner acknowledges. | S |
| BB0-19 | OPS | Record the Workers plan tier, the D1 size of both databases, and confirm Workflows is available on the account. Operator reads the dashboard. | this document | 1.4 third bullet answered. | S |
| BB0-20 | FS | Commit this plan; add it to `AGENTS.md` "Related plans"; ship the companion-plan edits in section 11 as one separate docs PR. | `AGENTS.md`, `docs/plans/` | Merged to `staging`. | S |

**Order:** BB0-0 and BB0-1 first, each alone. Then BB0-2 to BB0-10 as small independent PRs. BB0-12 and BB0-13 in parallel with them; BB0-14 to BB0-16 after BB0-13; BB0-17 last, alone, because it changes deletion.

**Phase BB0 double-check:** grep `components/`, `services/` and `worker/` for a numeric literal assigned to a score, grade, rate or confidence field that a user can see; grep for `Burn`; confirm no `worker_verified` literal is reachable without a verifier call; confirm `tests/paymentLedger`, `tests/telegramAuth` and the licence-key check in Zoro 2.8 pass; confirm a deleted account leaves no rows.

**Promote when:** every task's acceptance is green on staging; the owner has signed in on staging; the owner has confirmed production sign-in; the production deploy of BB0-1 is followed by a refused USDT invoice on production (a read-only API call that creates no payment).

---

## 5. Phase BB1 - Fix list, ship notes, approvals

**Goal:** a founder opens the app and sees their work: findings as a board, what they shipped, what an agent is waiting for them to approve, and one timeline of the business. Everything here works with the browser crew, before BB2.

### 5.1 Design

**Fix list.** A board over `audit_findings`. On a 360-pixel Mini App viewport three columns do not fit, so it is one column with a To do, Doing, Done switch and tap-to-move; no drag, which competes with Telegram's gestures. Every status change writes one `finding_events` row in the same D1 batch. "I shipped it" marks the finding done, offers a one-line note, and shows "Marked done by you. Not re-checked by Luminara." until BB2-9 adds the server re-check.

**Mission link.** The weekly `checklist_fix` mission stops being a client claim. It completes when a user-actor `finding_events` row moves a finding to `done` in that ISO week, in the same batch as the event. `view_delta` keeps its claim route. No points are involved; this stays inside `specs/0009`.

**Ship notes.** A note is at most 500 characters, optionally tied to a finding and a link. Private by default. The `visibility` column exists from the start because later migrations may not alter it, but no route sets `public` in BB1; public notes arrive with the proof feed in BB5, labelled self-reported.

**Approvals.** Oracle-ops F1 is adopted whole, including argument-bound single-use approvals. This plan adds one thing: Approve and Deny buttons on the Telegram notice. The handler resolves `callback_query.from.id` to an account, requires it to equal the request's account, and calls the same decide function as the route. A bearer key can never approve.

**Attention feed.** Oracle-ops F2 (Beacon) is adopted, with one amendment listed in section 11: the Telegram opt-in lives in D1, not KV, so it is consistent and exportable.

**Brain timeline v0.** One read endpoint merges, per project, the newest finding events, ship notes, weekly decisions and audit runs into a time-ordered list, each item with its source and date. It reads existing tables; it adds none.

**Playbook pages.** Public, static pages generated at build time from the compiled playbooks, one page per rule, linked from each finding by rule id. They are served through the marketing shell with real meta tags and return 404 for unknown slugs.

### 5.2 Migration `fix_list_ship_notes`

```sql
CREATE TABLE IF NOT EXISTS finding_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  finding_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  stable_key TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN ('open','in_progress','done','wont_fix')),
  actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user','agent','system')),
  actor_ref TEXT,
  note TEXT CHECK (note IS NULL OR length(note) <= 500),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_finding_events_finding
  ON finding_events(account_id, finding_id, created_at);
CREATE INDEX IF NOT EXISTS idx_finding_events_status
  ON finding_events(account_id, to_status, created_at);

CREATE TABLE IF NOT EXISTS ship_notes (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT,
  domain TEXT,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  finding_id TEXT,
  link_url TEXT CHECK (link_url IS NULL OR length(link_url) <= 1100),
  utc_day TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ship_notes_account
  ON ship_notes(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ship_notes_day
  ON ship_notes(account_id, utc_day);
```

- Validated on SQLite 3.51 against migrations 0001 to 0020 (section 18): applies, re-applies, and the checks reject an unknown status, an empty note and a note over 500 characters.
- `finding_events` carries `domain` and `stable_key` as well as `finding_id`, because BB0-10 changes how finding ids are issued and the pair is what survives a re-audit.
- No foreign key to `audit_findings`, matching the existing tables.
- The table values match `STATUSES` in `worker/findingsService.ts:11`.

### 5.3 Tasks

| ID | Lane | Task | Files | Acceptance | Size |
|---|---|---|---|---|---|
| BB1-0 | FS | Re-baseline and spec. Re-check 1.1 rows M1, M2, M5, G1, U1, U2. Write the spec. | this document, new `specs/<next>-fix-list-and-ship-notes.md` | Section 5 corrected. | S |
| BB1-1 | FS | View table. One array describes each view (enum value, lazy component, label, public flag, start-parameter tokens); the render switch, bottom nav, omnibar, public-view list and start-parameter parser read it. Additive: existing entries are moved, not changed. | `App.tsx`, `types.ts:9-42`, `components/telegram/TelegramBottomNav.tsx:13-25`, `components/OmnibarModal.tsx:26-42`, `services/auth/useAppAuth.ts:41-59`, `services/telegram/startParam.ts:22-48` | Every existing deep link and start parameter resolves as before (existing tests plus one table-driven test over all 32 views). Adding a view is one entry and one component. | M |
| BB1-2 | FS | Migration, registry entries (BB0-17), smoke lists, `FIX_LIST` in three blocks. | `migrations/`, `worker/accountTables.ts`, `scripts/smoke-check.mjs`, `wrangler.jsonc`, `worker/env.ts` | Applies clean at 0020. Delete and link-move tests cover both tables. | S |
| BB1-3 | FS | Status history and mission link per 5.1. `PATCH /findings/:id` writes the event and, when it applies, the mission completion in one `DB.batch`. `GET /findings/:id/events`. | `worker/findingsService.ts:240-270`, `worker/referrals.ts:557-584`, `services/referrals/rules.ts:22-41` | A user moving a finding to done creates one event and completes `checklist_fix` once for the week; repeating it completes nothing more. Flag off: no event row, and the claim route behaves as today. A finding of another account returns 404. | M |
| BB1-4 | FS | Ship-note routes on a new `/ship-notes` prefix: create (500 characters, 20 a day, dual rate limit, `readBody` cap), list with a cursor, delete. No route accepts `visibility`. | new `worker/shipNotes.ts`, `worker/index.ts`, `worker/authMiddleware.ts:151`, `worker/README.md` | Guest 401. The 21st note of a UTC day is refused. A note for another account's finding is refused. A request carrying `visibility:"public"` stores `private`. | S |
| BB1-5 | FS | Fix list UI per 5.1: `FixListView`, `FixCard`, `ShipItSheet`; hydrate from `GET /findings` (shared with verifiable-flow V2-9; the first to land owns the hydration); Mini App MainButton for the primary action; summary card on Home. | new `components/fixlist/`, `services/audit/findingBoardService.ts:41,52,170,220`, `components/suite/DashboardView.tsx`, `services/telegram/tma.ts:358-382` | A second browser on the same account shows the same board. Each status change is one request. Pure helpers are exported and unit-tested (the house pattern; there is no DOM test setup). No raw colour classes (honesty gate). | M |
| BB1-6 | FS | Sign-off Desk. Adopt oracle-ops F1 unchanged. | per oracle-ops F1 | Oracle-ops Phase 1 drill steps 1 to 5. | L |
| BB1-7 | FS | Telegram approval buttons per 5.1. Needs decision 7 for the notice itself. | `worker/telegramBot.ts:290,320-321`, `worker/mcpGovernance.ts:108-231`, `scripts/telegram-setup.mjs:29-34` | Approve from Telegram executes the bound call once. A tap from a Telegram user who does not own the request is refused and audited. An expired request answers "Expired". The notice contains no tool arguments. | M |
| BB1-8 | FS | Beacon. Adopt oracle-ops F2 with the section 11 amendment. | per oracle-ops F2 | Oracle-ops Phase 1 drill steps 6 and 7. | M |
| BB1-9 | FS | Brain timeline v0 per 5.1: `GET /brain/timeline?projectId=&cursor=`, at most 20 rows from each source per page, account-scoped, with `ETag`. A Timeline tab in the memory view backed by it; items held only on the device are labelled "On this device". | new `worker/brainTimeline.ts`, `components/suite/BrandMemoryView.tsx:166-268` | Two accounts never see each other's items (test). An empty project returns an empty list, not an error. | M |
| BB1-10 | FS | Playbook pages per 5.1. First confirm the licence of the vendored playbook sources allows publishing them and add the attribution it requires. | `scripts/build-playbooks.mjs`, `utils/marketingRoutes.ts:120-167`, `worker/index.ts:2039-2056`, `worker/marketingShell.ts`, `THIRD_PARTY_NOTICES.md` | Licence recorded in the PR. Each page has a unique title and description. An unknown slug returns HTTP 404. A finding with a rule id links to its page. | M |

**Order:** BB1-0; then BB1-1 alone (it touches `App.tsx`); then BB1-2 to BB1-4 on the Worker lane and BB1-10 in parallel; then BB1-5, BB1-9; BB1-6 to BB1-8 follow oracle-ops Phase 1's own order.

**Phase BB1 double-check:** confirm no route sets a ship note public; confirm the mission cannot complete from a client flag when the flag is on; confirm an approval tap from the wrong Telegram user changes nothing; confirm both new tables are in the registry; confirm every new view resolves in the Mini App, on the web and in the desktop shell.

**Scripted soak:** 7 days with `FIX_LIST` on in staging: 200 scripted status changes and 100 notes across 5 scripted accounts, zero 5xx. **Promote when:** the soak report is attached; the owner has worked a real Fix list on staging in the Mini App and on the web; the owner has approved one request from Telegram.

---

## 6. Phase BB2 - Server-side crew

**Goal:** an audit, a re-check and later every job run on the server as durable steps, finish with the app closed, cost no more than their cap, and cannot show a number that was not measured. This phase is verifiable-flow V6, approved by decision 10 and specified here.

### 6.1 Design

**Runner.** One Workflows class, `CrewRunWorkflow`. A recipe is a typed list of steps in `services/crew/recipes/`. Each step is one `step.do` with an explicit retry policy. A provider failure retries that step; the run resumes from it. A guard, validation or budget failure throws a non-retryable error and fails the run with a code. The run always reaches a settle step.

**Why Workflows and not the queue.** The existing queue consumer swallows errors and has no checkpoint. Workflows gives retries, sleeping and waiting for an approval event as platform features. If BB2-0 finds Workflows unusable on the account, the fallback is one queue message per step with the same `crew_run_steps` table as the checkpoint; the routes and tables do not change.

**The ledger is D1, the executor is Workflows.** `crew_runs` and `crew_run_steps` are what the app, the operator and the cost gate read. A step's large output (page text, a draft) is written to R2 or D1 and only its reference is returned, which keeps every step result far below 1 MiB.

**Roster.** Four named agents the founder sees, and two internal roles.

| Agent | Does | Step kinds | May write |
|---|---|---|---|
| Scout | Fetches pages, crawler files and search evidence | `fetch` | Evidence rows |
| Auditor | Runs the shared rule definitions; asks a model for findings that must cite evidence refs | `rule`, `llm` | Findings, observations |
| Fixer | Drafts the fix for a finding as a prepared asset | `llm` | `prepared_assets` in `draft` only |
| Coach | Chooses the one weekly action and explains it (BB4 gives it a thread) | `llm` | Weekly decision draft |
| Verifier (internal) | Drops any claim without a known evidence ref; runs the number guard | `verify` | Nothing |
| Reporter (internal) | Builds the report from typed sections | `write` | One agent report |

Prompts are versioned rows in `agent_skills`; the tool list and step kinds are code. No agent in BB2 has a tool that writes outside the founder's own account.

**Recipe `instant_audit_v2`.** resolve target, fetch pages, fetch crawler files, search evidence, rules, model findings, verify, fix drafts, report, persist, notify. The persist step writes `audit_runs` (origin `server`), `audit_evidence` (fetcher `worker`), `finding_observations` and the finding upserts through verifiable-flow V2's ledger, so a server run and a browser run share one schema.

**Typed output.** `generateTyped(schema, prompt)` sends a JSON schema where the provider supports it, validates with `zod`, retries once with the validation errors, and on a second failure returns a typed `not_measured` result. Raw model text never reaches a user from a typed step.

**Number guard.** Before any model text is stored or sent, every numeral in it must appear in the run's evidence set: numbers taken from measured evidence rows, connector snapshots (BB3) and the user's own request. Dates, list ordinals and counts of items the text itself lists are allowed by explicit rules. A numeral outside the set has its sentence span replaced with "not measured" and the step records how many were replaced. The guard blocks; it does not flag.

**One hosted model client.** `worker/llm/hostedLlm.ts` replaces the hand-rolled fetches. It knows each provider's lineage, sets a timeout, retries once, fails over, records token use, prices the call from a versioned rate card and refuses a model that is not on the card. It never spends the user's daily free quota.

**Budget.** A run has `cap_cents`, fixed at start from the plan. Before each model call the client checks that spend so far plus the worst case for this call fits the cap. Spend is tracked in micro-dollars (millionths) because one call costs far less than a cent. At settle, one `cost_events` row is written for the run with the sum rounded up to whole cents, so the existing budget windows and `BUDGET_ENFORCEMENT` see it. The start gate counts the caps of runs still active as reserved. Subscribers are not unlimited for server runs.

**One active run.** A partial unique index allows one queued, running or waiting run per account, recipe and domain. A second start returns the first run.

**Trust.** A run that ingests web content is `sealed` (oracle-ops F3's vocabulary). In BB2 no recipe has an external write, so sealing has nothing to block; the column is set from the start so BB4 can enforce it.

**Fetching.** All fetches go through `worker/publicFetch.ts` (Allora CL0-3). Unlike Allora's checks, the crew gives fetched text to a model, so three more rules apply: the text is fenced as untrusted wherever it enters a prompt; raw page text is kept 30 days and then only its hash remains; and Zoro's DNS-rebinding task (P1-3b) lands before production.

**Server re-check.** "I shipped it" may start the recipe `recheck_finding`: fetch the page and run the one rule. The result is a new observation and one of the Allora 3.5 strings on the card ("Retest {date}: issue no longer found in page source", "issue still found", "not measured"). Only "no longer found" counts as a verified ship for a mission, the ladder or the gated chat.

### 6.2 Migration `crew_runs`

```sql
CREATE TABLE IF NOT EXISTS crew_runs (
  run_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT,
  domain TEXT,
  recipe TEXT NOT NULL,
  recipe_version INTEGER NOT NULL,
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('user','schedule','job','recheck','system')),
  trigger_ref TEXT,
  idempotency_key TEXT NOT NULL,
  workflow_instance_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','running','waiting_approval','succeeded','failed','cancelled')),
  trust TEXT NOT NULL DEFAULT 'standard' CHECK (trust IN ('standard','sealed')),
  cap_cents INTEGER NOT NULL CHECK (cap_cents >= 0),
  spent_micro INTEGER NOT NULL DEFAULT 0 CHECK (spent_micro >= 0),
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  deliverable_kind TEXT,
  deliverable_ref TEXT,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  updated_at INTEGER NOT NULL,
  UNIQUE (account_id, idempotency_key),
  CHECK (status NOT IN ('succeeded','failed','cancelled') OR finished_at IS NOT NULL),
  CHECK (status <> 'failed' OR error_code IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_crew_runs_account
  ON crew_runs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crew_runs_status
  ON crew_runs(status, updated_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crew_runs_one_active
  ON crew_runs(account_id, recipe, IFNULL(domain, ''))
  WHERE status IN ('queued','running','waiting_approval');

CREATE TABLE IF NOT EXISTS crew_run_steps (
  run_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  account_id TEXT NOT NULL,
  step_key TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fetch','rule','llm','verify','write','approval','notify')),
  status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','skipped','waiting')),
  attempt INTEGER NOT NULL DEFAULT 1,
  provider TEXT,
  model TEXT,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_micro INTEGER NOT NULL DEFAULT 0 CHECK (cost_micro >= 0),
  guard_rewrites INTEGER NOT NULL DEFAULT 0,
  measurement_status TEXT
    CHECK (measurement_status IS NULL OR measurement_status IN ('measured','estimated','not_measured')),
  output_ref TEXT,
  error_code TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  PRIMARY KEY (run_id, seq),
  UNIQUE (run_id, step_key)
);
CREATE INDEX IF NOT EXISTS idx_crew_steps_account
  ON crew_run_steps(account_id, started_at);
```

- Validated on SQLite 3.51 against 0001 to 0020 with and without verifiable-flow's `run_ledger` applied first (section 18). Checked: a second active run for the same account, recipe and domain is refused, including when the domain is NULL; a different domain, recipe or account is allowed; a finished run frees the slot; a failed run needs an error code; a terminal run needs a finish time; the idempotent start inserts nothing and the existing row is found; a step retry is an upsert on `(run_id, seq)` that raises `attempt`; the settle update succeeds once.
- An upsert against `idx_crew_runs_one_active` is never used; the start inserts and, on a unique error, reads the active row. An upsert on a partial or expression index must repeat its expression and `WHERE` (verifiable-flow 2.1), which is easy to get wrong.
- `run_id` equals the `run_provenance.run_id` opened for the run and, for an audit recipe, the `audit_runs.id`. No foreign keys, matching the ledger tables.
- `seq` is the step's index in the recipe, so a retried step addresses the same row.
- No column holds prompt text, page text or user text. `output_ref` points at an R2 key or a row id.

### 6.3 Tasks

| ID | Lane | Task | Files | Acceptance | Size |
|---|---|---|---|---|---|
| BB2-0 | AI | Re-baseline, spike and spec. Bind a Workflows class on staging and run a three-step toy recipe with a forced step failure. Measure tokens, cost and wall time for each model step on 10 real domains with hosted keys. Count subrequests per run. Propose `cap_cents` and weekly run counts per plan for decision 11. Record which prerequisites in BB2-1 have merged. | this document, new `specs/<next>-server-crew-runs.md` | The toy run resumes from the failed step. Section 6 corrected. A table of measured cost per step with n. If Workflows is unusable, the queue fallback is chosen here and stated. | M |
| BB2-1 | FS | Prerequisites, each done under its own plan's id if not yet merged: verifiable-flow V2-1 to V2-3 (`run_ledger`, provenance types, rule ids), Allora CL0-3 and CL0-5 (`worker/publicFetch.ts`, `services/audit/ruleDefinitions.ts`), Zoro P1-3b (DNS rebinding) and P1-4 (the hosted call), BB0-15. | per those plans | Each prerequisite's own acceptance. | L |
| BB2-2 | OPS | Migration, registry, smoke lists, flag. Bindings in three blocks: `workflows` (`luminara-crew-run`, `luminara-crew-run-staging`) and an R2 bucket `CREW_EVIDENCE` (`luminara-crew-evidence`, `-staging`) with a 30-day lifecycle rule on the `raw/` prefix. Operator creates the buckets first. | `migrations/`, `wrangler.jsonc`, `worker/env.ts`, `worker/accountTables.ts`, `scripts/smoke-check.mjs`, `scripts/validate-env.mjs` | Applies clean. `env:validate` passes in both modes. A staging deploy with the flag off changes no behaviour. Deleting an account removes its rows and its bucket prefix. | M |
| BB2-3 | AI | Hosted model client and rate card per 6.1. Then move each call site to it, one PR each, with an equivalence test. | new `worker/llm/hostedLlm.ts`, `worker/llm/rateCard.ts`; then `worker/oracleChat.ts:260-272`, `worker/ideaScout.ts:125-151`, `worker/telegramBot.ts:195-283`, `services/tools/registry.ts:47-71` | A timeout fails over to the next lineage. A model missing from the rate card is refused. Token use is recorded for every call. No call through the client changes the user's daily quota counter (spy). | L |
| BB2-4 | AI | `generateTyped` per 6.1. Add `zod` at an exact version; add its notice. | new `worker/llm/typed.ts`, `package.json`, `THIRD_PARTY_NOTICES.md` | A malformed first reply and a valid second reply yield the typed value with one retry (recorded fixture). Two malformed replies yield `not_measured` and no raw text. | M |
| BB2-5 | AI | Number guard per 6.1, built on the existing validators. Golden fixtures in `evals/`. | new `worker/guardrails/numberGuard.ts`, `worker/agentOutputValidators.ts:96-123`, `evals/` | A percentage absent from the evidence set is replaced. A number present in a measured evidence row passes. A date and a list ordinal pass. The fixtures run in CI. | M |
| BB2-6 | AI | Run budget per 6.1: reserve at start, check before each call, settle once. Weekly run counts in `planCapsFor` and its client mirror. | `worker/budgets.ts:292-322,451-477`, `worker/telegramBot.ts:43-149`, `services/plans/planEntitlements.ts:26-87` | A run stops with `BUDGET_CAP` before the call that would exceed its cap. Settle writes exactly one `cost_events` row, even when called twice. With `BUDGET_ENFORCEMENT=hard` and the month's limit reached, a start is refused. A subscriber past the weekly count is refused. | M |
| BB2-7 | AI | `CrewRunWorkflow`, the recipe engine and `instant_audit_v2` per 6.1. | new `worker/crew/workflow.ts`, `worker/crew/steps/`, `services/crew/recipes/instantAuditV2.ts`, `services/crew/roster.ts`, `worker/index.ts` (export the class) | The fixture domain yields at least the findings the browser crew yields for the four rules. Killing a provider mid-run resumes at that step with `attempt` 2. A run never stays `running` after its Workflows instance ends (test with a forced terminal error). Every model finding stored cites a known evidence ref. | L |
| BB2-8 | FS | Routes on a new `/crew` prefix: start (idempotent), list, detail with `ETag`, cancel. The Instant Audit view starts a server run when the flag is on and the plan allows, and renders the steps table; the browser crew stays for guests, bring-your-own-key and flag off. | new `worker/crew/routes.ts`, `worker/authMiddleware.ts:151`, `worker/README.md`, `components/audit/InstantAuditView.tsx:245-454`, `components/audit/AgentMissionControl.tsx`, `services/apiClient.ts` | Guest 401. Another account's run id 404. The same idempotency key twice returns one run. Closing the tab and reopening shows the finished run. Flag off: the view behaves as today (characterisation test written first). | L |
| BB2-9 | FS | Server re-check per 6.1: recipe `recheck_finding`, the button on the Fix card, the Allora strings, at most 5 re-checks per account per day and one per finding per 24 hours, both enforced in the insert. | `services/crew/recipes/recheckFinding.ts`, `components/fixlist/`, `worker/crew/routes.ts` | A finding whose rule now passes shows the "no longer found" string with the server's date. A page that cannot be fetched shows "not measured" and does not count as a verified ship. The sixth request of a day is refused. | M |
| BB2-10 | AI | Trace read: `GET /crew/runs/:id/steps`; expose the existing `getRunChain` to the run owner and to an operator route. | `worker/runProvenance.ts`, `worker/crew/routes.ts` | A run's steps list shows role, kind, status, attempt, model and cost. No prompt or page text is returned. | S |
| BB2-11 | AI | Evals and injection corpus. Recorded-output fixtures for typed findings, the guard and the verifier in CI. The oracle-ops section 11 injection corpus is replayed through the fetch and model steps. A live-model run by hand before promotion. | `evals/`, `tests/fixtures/injection/`, `.github/workflows/ci.yml` | No fixture page causes a stored finding without an evidence ref, a write outside the account, or an unguarded number. The live report is attached to the promotion PR. | M |
| BB2-12 | FS | Retire the shell. `POST /audit/run` starts a crew run. The old consumer drains for one release and is then removed. | `worker/index.ts:1806-1830`, `worker/auditQueue.ts:229-322` | No response contains `AUDIT_V1_MINIMAL`. The Agency gate on `/audit/run` is unchanged (existing test). | S |

**Order:** BB2-0; BB2-1; BB2-2; then BB2-3 to BB2-6 in parallel; BB2-7; BB2-8 and BB2-10; BB2-9; BB2-11; BB2-12 last.

**Phase BB2 double-check:** grep for any `fetch(` to a model provider outside `worker/llm/`; confirm no step returns page text in its result; confirm no run row is non-terminal while its instance is terminal; confirm `spent_micro` never exceeds `cap_cents * 10000` on any soak run; confirm the Agency pattern list in `worker/apiAccess.ts` is unchanged; confirm every `crew_*` behaviour is inert with the flag off.

**Scripted soak:** 7 days. **Promote when:** at least 50 server runs on staging across at least 10 real domains; zero runs non-terminal after 15 minutes; every failed run has an error code and a settle row; no run over its cap; the guard and injection fixtures green; the owner has run 5 audits with the tab closed and read each report; run time p50 and p95 recorded with n and accepted by the owner. **Production gets** the migration and code with the flag off; turning it on is its own PR, canaried on the owner's account first.

---

## 7. Phase BB3 - Business Brain

**Goal:** the founder's business knowledge is one sourced, dated, reviewable store that every agent reads before it answers, and it contains measured numbers from the founder's own Google data.

### 7.1 Design

**The brain is a read model, not a new copy.** Project context, findings, decisions, ideas, reports, ship notes and runs stay in their tables. The brain adds three things: provenance and review on facts, connector snapshots, and one digest that both chat paths and every recipe load (verifiable-flow V3's context assembler, extended).

**Facts become records.** A fact gets a status, a source reference and a link to the fact it replaces. Verifiable-flow V3 adds project, domain, kind, content hash and last-seen. A fact written by an agent or extracted from chat starts as `proposed` and is used in prompts only after the founder approves it; a fact the founder types is `active`. Today's chat auto-store writes straight to active at confidence 0.72 (`worker/memoryRag.ts:298-309`); under `BRAIN_RECORDS` it proposes instead. Facts can be edited and deleted, which no route allows today.

**Connectors.** Search Console and GA4, read-only.

- *Tokens.* Refresh tokens are encrypted with AES-256-GCM under a per-environment Worker secret, with a random IV per row, the account id and connector id as additional data, and a key id column for rotation. The existing `gsc_oauth_tokens` table holds one token per account and no key id; it is left unused and is not dropped.
- *Flow.* Google blocks sign-in inside embedded webviews, so the consent screen opens in the system browser from the Mini App and the desktop shell. That browser has no Luminara session, which opens an account-linking attack: an attacker starts a flow in their own account and sends the victim the link. The flow therefore needs two things from the real user. First, the app shows a six-digit code that the user types on Luminara's own start page before being sent to Google; the page names the Luminara account being connected. Second, the tokens wait encrypted in a pending row for ten minutes and attach only when the session that started the flow calls complete, after the app shows the Google account that consented. The flow row is consumed once by a conditional update.
- *What is stored.* Aggregates only: for Search Console, 28-day totals and the top 50 queries and pages; for GA4, 28-day sessions by channel and top landing pages. One row per source, metric set and period end, at most 64,000 characters. No user-level data is requested.
- *Sync.* Weekly per source, claimed by a lease on the daily cron. `invalid_grant` marks the connector `needs_reauth` and raises a Beacon item.
- *Limited Use.* Connector data is used only to show the founder their own data and to ground their own agents. It is sent only to model providers on an allowlist whose terms exclude training. It is never used to train or evaluate anything shared. Operators do not read it. The connect screen states this.

**Search queries are hostile text.** A query string in Search Console is typed by a stranger. Snapshots are fenced as untrusted in every prompt, and a run that loads them is sealed.

**Measured numbers for the guard.** Numbers in the latest snapshots join the evidence set of BB2's number guard, with their source and period. This is how an agent can say "412 clicks in the 28 days to 9 October (Search Console)" and cannot say "traffic is up 30%".

### 7.2 Migration `brain_connectors`

Applies after verifiable-flow's `scoped_memory`. It also applies cleanly before it; the two touch different columns.

```sql
ALTER TABLE memory_facts ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active','proposed','superseded','rejected'));
ALTER TABLE memory_facts ADD COLUMN source_ref TEXT;
ALTER TABLE memory_facts ADD COLUMN supersedes_id TEXT;
CREATE INDEX IF NOT EXISTS idx_memory_facts_status
  ON memory_facts(account_id, status, created_at);

CREATE TABLE IF NOT EXISTS connector_flows (
  nonce_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  user_code_hash TEXT,
  pending_token_enc TEXT,
  pending_subject_hint TEXT,
  status TEXT NOT NULL CHECK (status IN ('started','consented','completed','expired','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_connector_flows_account
  ON connector_flows(account_id, created_at);

CREATE TABLE IF NOT EXISTS connector_accounts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  external_subject_hash TEXT NOT NULL,
  display_hint TEXT,
  scopes TEXT NOT NULL,
  refresh_token_enc TEXT NOT NULL,
  enc_key_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','needs_reauth','revoked')),
  last_refresh_at INTEGER,
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (account_id, provider, external_subject_hash)
);

CREATE TABLE IF NOT EXISTS connector_sources (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  project_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('gsc_site','ga4_property')),
  external_id TEXT NOT NULL,
  display_name TEXT,
  domain_match TEXT NOT NULL CHECK (domain_match IN ('match','mismatch','unknown')),
  status TEXT NOT NULL CHECK (status IN ('active','paused','error')),
  last_synced_at INTEGER,
  lease_until INTEGER,
  sync_attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (connector_id, kind, external_id)
);
CREATE INDEX IF NOT EXISTS idx_connector_sources_account
  ON connector_sources(account_id, status);
CREATE INDEX IF NOT EXISTS idx_connector_sources_due
  ON connector_sources(status, last_synced_at);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  source_id TEXT NOT NULL,
  metric_set TEXT NOT NULL CHECK (metric_set IN ('gsc_search_28d','ga4_traffic_28d')),
  period_end TEXT NOT NULL,
  period_start TEXT NOT NULL,
  account_id TEXT NOT NULL,
  project_id TEXT,
  payload_json TEXT NOT NULL CHECK (length(payload_json) <= 64000),
  row_count INTEGER NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (source_id, metric_set, period_end)
);
CREATE INDEX IF NOT EXISTS idx_metric_snapshots_account
  ON metric_snapshots(account_id, project_id, metric_set, period_end);
```

- Validated on SQLite 3.51 (section 18): existing facts read as `active` with their old `source`; an unknown status is refused; a proposed fact is approved once, only by its account; a flow is consumed once, only by its account, and not after expiry; the source lease claim hands out each source once; a second connector for the same Google subject is refused; a snapshot over 64,000 characters is refused; a second sync of one period replaces the row.
- The three `ALTER`s are not idempotent. Confirm with `migrations list` that the file is unapplied before running (Zoro 2.5). The `ALTER` with `NOT NULL DEFAULT` and a `CHECK` is accepted by SQLite because every existing row takes the default.
- The existing `source` column (`hosted`, `chat`) gains the values `agent`, `connector` and `audit` in code. It has no `CHECK`, so no schema change is needed.
- `connector_flows` is in D1, not KV, because the start and the callback can land in different locations seconds apart and KV is eventually consistent.
- `external_subject_hash` is a salted hash of Google's subject id; `display_hint` is the masked email shown back to the founder. The plain subject id is not stored.

### 7.3 Tasks

| ID | Lane | Task | Files | Acceptance | Size |
|---|---|---|---|---|---|
| BB3-0 | OPS | Long lead, owner and operator. Create the Google Cloud project and consent screen; record how the console classifies the two scopes; publish the privacy sentence; record the demo video; submit for verification. Re-baseline section 7. Write the spec. | this document, new `specs/<next>-business-brain-and-connectors.md`, `worker/privacyPolicy.ts` | Verification submitted, or the plan states connections stay staging-only. | M |
| BB3-1 | FS | Adopt verifiable-flow V3-1 to V3-6b (scoped memory, the shared context assembler, both chat paths). | per verifiable-flow section 6 | Per V3. | L |
| BB3-2 | OPS | Migration, registry, smoke lists, both flags. Secrets per environment, set by the operator: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `CONNECTOR_ENC_KEY_V1`. | `migrations/`, `wrangler.jsonc`, `worker/env.ts:178-179`, `worker/accountTables.ts`, `scripts/smoke-check.mjs` | Applies clean on a database with and without `scoped_memory`. Deleting an account revokes the Google token, then removes all four tables' rows. | M |
| BB3-3 | OPS | Secret box and leak guards. AES-256-GCM helper with key id; secret-scan patterns for Google client secrets and refresh tokens; log redaction for `code` and `id_token` keys and for a refresh token inside an error string; Sentry receives redacted text. | new `worker/secretBox.ts`, `scripts/check-secrets.mjs:32-46`, `worker/logRedaction.ts:56-86`, `worker/sentry.ts:15-23`, `worker/index.ts:1895` | Decrypting with the wrong account id as additional data fails. A row encrypted under key id 1 still decrypts after key id 2 becomes current. A thrown error containing a token is logged and reported without it (test). | M |
| BB3-4 | FS | OAuth flow per 7.1 on a new `/connectors` prefix: start, the first-party code page, callback, complete, disconnect (revoke at Google, then delete). Google hosts on a fixed allowlist, not through `fetchPublicUrl`. `state` is a 256-bit nonce stored hashed. | new `worker/connectors/google.ts`, `worker/authMiddleware.ts:151`, `worker/README.md`, `services/telegram/tma.ts` (open link), `electron/preload.cjs:8-22` (`openExternal` exists) | A flow started by account A cannot be completed by account B. A wrong code three times cancels the flow. A replayed callback is refused. The callback page shows no token and sets no session. Disconnect leaves no token row and Google reports the token invalid. | L |
| BB3-5 | FS | Source picker. List Search Console sites and GA4 properties; match each to a project domain; a mismatch is allowed and labelled. | `worker/connectors/google.ts`, new `components/brain/ConnectionsPanel.tsx` | A domain property matches its project. A property for another domain is labelled "Different site" and its numbers are never attributed to the project. | M |
| BB3-6 | FS | Weekly sync on the daily cron with the lease claim; aggregates per 7.1; quota-aware; reauth path. Mapped in `CRON_JOBS`. | new `worker/connectors/sync.ts`, `worker/scheduledJobs.ts`, `worker/index.ts:2059-2068` | Two overlapping cron runs sync each source once. A revoked token marks the connector and raises one Beacon item. A snapshot never exceeds its size cap. | M |
| BB3-7 | AI | Records per 7.1: proposals from agents and chat, review queue, edit, delete, supersede. An MCP write tool `propose_brain_record` that always lands `proposed`. | `worker/memoryService.ts:33-99`, `worker/memoryRag.ts:291-334`, `worker/mcpServer.ts:186-405`, `worker/mcpGovernance.ts:21-43` | A proposed fact is absent from every prompt until approved. An agent cannot create an `active` fact. Flag off: today's behaviour exactly. | M |
| BB3-8 | AI | Digest. A "Measured data" block in the context assembler from the latest snapshots, with source and period, fenced; its numbers join the guard's evidence set; a run that loads it is sealed. | `services/oracle/contextAssembler.ts` (from V3-3), `worker/guardrails/numberGuard.ts` | A golden prompt shows the block with dates. An agent reply quoting a snapshot number passes the guard; a derived percentage is replaced. An instruction planted in a query string is not followed (recorded fixture). | M |
| BB3-9 | FS | Business Brain page: Records with source, date and status; Timeline (from BB1-9); Connections; Review queue. Items held only on the device are labelled. | `components/suite/BrandMemoryView.tsx`, new `components/brain/` | Every record shows where it came from and when. The existing `memory` and `vault` deep links still open the page. | M |
| BB3-10 | AI | MCP read tools in the free class for Growth and above: `get_brain_digest`, `list_findings`, `list_metric_snapshots`. Governance entries; reads of sealed content seal the caller once F3 exists. | `worker/mcpServer.ts`, `worker/mcpGovernance.ts`, `specs/0004-mcp-entitlements-and-credits.md` | Each tool refuses another account's project. `tests/apsMcp` passes. | M |
| BB3-11 | OPS | Limited Use controls: the provider allowlist for prompts that contain connector data, enforced in the hosted client; the disclosure string; an operator access note. | `worker/llm/hostedLlm.ts`, new `docs/ops/CONNECTOR-DATA.md` | A prompt tagged as containing connector data is refused by a provider not on the allowlist (test). | S |

**Order:** BB3-0 at once, because verification takes weeks. Then BB3-1; BB3-2 and BB3-3; BB3-4; BB3-5 and BB3-6; BB3-7 to BB3-10 in parallel; BB3-11 before any production flag.

**Phase BB3 double-check:** grep for a refresh or access token in any log call, response body or test snapshot; confirm every connector prompt block is fenced; confirm no snapshot row is readable across accounts or attributed to a mismatched project; confirm account deletion revokes before it deletes; confirm no chat path writes an `active` fact from model output.

**Scripted soak:** 14 days on staging with the owner's own Google account (two weekly syncs). **Promote when:** both syncs ran once each; a forced revoke produced one reauth notice; the owner has asked five questions that the agents answered with dated Search Console numbers; Google verification is complete, or the production flag stays off.

---

## 8. Phase BB4 - Crew in Telegram, roster, Agent Jobs

**Goal:** the founder talks to named agents where they already are, buys an outcome at a fixed price and gets it or gets their Stars back, and recurring work runs on a schedule.

### 8.1 Prerequisites

Oracle-ops Phase 2 exited with `SEALED_LANE` enforcing; decision 12 answered and spec 0016 K1 and K2 landed (sessions, `estimate_cost`); TN1 and TN2 turned on in production after BB0-3; Zoro Phase 2 shipped; a staging bot that can take test Star payments (BB0-12).

### 8.2 Design

**Coordinator.** One SQLite Durable Object per account, `FounderAgent`. It serialises that founder's inbound Telegram messages, holds one thread per roster agent, and owns that founder's schedule through its alarm. It replaces the six-turn KV history. BB4-0 decides whether it extends the Agents SDK class or a plain Durable Object behind the same interface; the rest of the Worker imports only `worker/crew/founderAgent.ts`.

**What a thread can do.** Read the brain digest, findings and runs. Start a crew run inside the plan's caps. Propose a fact, a ship note or a weekly decision draft. It has no tool that writes outside the account. Replies go through `generateTyped` and the number guard. A reply is a verdict, one action and a link, per APS invariant 4.

**Send policy (decision 7).** One function sends every notice. It checks opt-in, the daily cap, mute, and that the chat was started or write access was granted; it paces to one message a second per chat and honours `retry_after`. Categories: approval, run result, retest result, job delivered, weekly brief. There is no "come back" message. Opt-in is asked once, in context, the first time the founder starts something that will finish later, using the Mini App's write-access prompt. `/stop` mutes everything.

**Agent Jobs.** TN6's design, specified. A job is a recipe with a fixed price and a deterministic acceptance check. Luminara is the seller; the fulfiller is Luminara's own crew.

```
quoted -> awaiting_payment -> paid -> running -> checking -> delivered
                 |               |        |          |
                 +-> cancelled   +--------+----------+-> refund_due -> refunded
```

- The Star invoice payload is `job:<id>`, never a plan id. Pre-checkout re-reads the job row and refuses unless it is `awaiting_payment` at the quoted price. The pay transition is one conditional update that also stores the charge id; a second payment for the same job fails it and is refunded.
- A job never touches the subscription record.
- If the run fails or the acceptance check fails, the job becomes `refund_due` and the whole charge is refunded to the payer's Telegram id. A reconciler on the 15-minute cron retries refunds and pages the operator if any job waits more than an hour.
- A delivered job writes its report, an `agent_job_delivered` receipt and a Beacon item.
- Inside Telegram a job is paid in Stars. A subscriber's plan may include jobs (`price_currency = 'included'`, decision 15). There is no TON or Jetton price for a job.

**First catalog.** The three TN6 jobs whose acceptance check is deterministic today:

| Job | Deliverable | Acceptance check |
|---|---|---|
| Schema fix pack | JSON-LD blocks for the verified entity | Parses; types valid; `sameAs` lists only verified links |
| `llms.txt` and robots AI policy | File contents and placement steps | Parses; after the founder deploys, a server fetch finds it (optional retest) |
| Competitor research brief | A saved report | Every figure cites an evidence ref or reads "not measured"; the guard rewrote nothing in the final text |

**Scheduled runs (decision 16).** Read-only recipes only: a weekly re-audit of the founder's verified domain, and a re-check when a connector snapshot changes sharply. The coordinator's alarm starts them inside the plan's weekly count. This replaces Sentinel's daily re-enqueue of the old shell.

### 8.3 Migration `agent_jobs_notify`

```sql
CREATE TABLE IF NOT EXISTS agent_jobs (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  project_id TEXT,
  domain TEXT,
  job_type TEXT NOT NULL,
  catalog_version INTEGER NOT NULL,
  fulfiller TEXT NOT NULL DEFAULT 'agent' CHECK (fulfiller IN ('agent','human')),
  price_currency TEXT NOT NULL CHECK (price_currency IN ('XTR','included')),
  price_amount INTEGER NOT NULL CHECK (price_amount >= 0),
  status TEXT NOT NULL CHECK (status IN
    ('quoted','awaiting_payment','paid','running','checking','delivered','refund_due','refunded','cancelled')),
  payment_charge_id TEXT,
  payer_telegram_id TEXT,
  run_id TEXT,
  report_id TEXT,
  receipt_id TEXT,
  acceptance_json TEXT,
  refund_attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  paid_at INTEGER,
  finished_at INTEGER,
  updated_at INTEGER NOT NULL,
  CHECK (price_currency <> 'XTR' OR price_amount > 0),
  CHECK (status NOT IN ('paid','running','checking','delivered','refund_due','refunded')
         OR price_currency = 'included' OR payment_charge_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_jobs_charge
  ON agent_jobs(payment_charge_id) WHERE payment_charge_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_jobs_account
  ON agent_jobs(account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_status
  ON agent_jobs(status, updated_at);

CREATE TABLE IF NOT EXISTS notify_prefs (
  account_id TEXT PRIMARY KEY,
  telegram_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (telegram_opt_in IN (0,1)),
  weekly_brief INTEGER NOT NULL DEFAULT 0 CHECK (weekly_brief IN (0,1)),
  daily_cap INTEGER NOT NULL DEFAULT 5 CHECK (daily_cap BETWEEN 0 AND 5),
  muted_until INTEGER,
  updated_at INTEGER NOT NULL
);
```

- Validated on SQLite 3.51 (section 18): a Stars job cannot be priced at zero; a job cannot be paid or later without a charge id unless the plan includes it; one charge id cannot pay two jobs; the pay and refund transitions each succeed once; preferences default to opted out; a daily cap above 5 is refused.
- The table name `agent_jobs` is the one TN6 reserves; this migration is TN6's.
- `fulfiller = 'human'` exists for Luminara Digital's own done-for-you work (TN6). No third party can be a fulfiller.
- The Durable Object class needs one appended tag at top level, for example `{ "tag": "v2-founder-agent", "new_sqlite_classes": ["FounderAgent"] }`, and a binding in all three blocks. A tag cannot be un-applied; an unused class is left idle.

### 8.4 Tasks

| ID | Lane | Task | Files | Acceptance | Size |
|---|---|---|---|---|---|
| BB4-0 | AI | Re-baseline and spike. Run the `agents` package on staging under this Worker's `migrations` configuration and compatibility date; compare with a plain Durable Object on five criteria: deploys cleanly, alarm scheduling correct after a redeploy, bundle size, typecheck clean, no second approval store. Take one test Star payment and one refund with the staging bot. Propose job prices from BB2's measured run cost. Write the spec. | this document, new `specs/<next>-crew-telegram-and-agent-jobs.md` | The choice is recorded with the five results. A Star payment and its refund both appear on staging. | M |
| BB4-1 | OPS | Migration, registry, smoke lists, flags, the class tag and bindings. Webhook `allowed_updates` reviewed. | `migrations/`, `wrangler.jsonc`, `worker/env.ts`, `worker/index.ts` (export), `scripts/telegram-setup.mjs:29-34` | Applies clean. Staging deploys with all flags off and no behaviour change. | M |
| BB4-2 | FS | Send policy per 8.2, built on Beacon's push. 429 handling in the bot's `api()`. The write-access prompt in the Mini App. `/stop`. | `worker/telegramBot.ts:151-173`, `worker/beacon.ts` (from F2), new `worker/notify.ts`, `services/telegram/tma.ts` | No message is sent to an account that has not opted in. The sixth notice of a day is skipped and recorded. A 429 is retried after `retry_after`. `/stop` silences every category. | M |
| BB4-3 | AI | `FounderAgent` per 8.2 and the inbound route from the webhook. Deletion and account linking reach its storage through the registry. | new `worker/crew/founderAgent.ts`, `worker/telegramBot.ts:768-923`, `worker/accountTables.ts` | Two messages sent at once are answered in order. A reply with an unmeasured number is rewritten. A thread cannot write outside the account (tool list test). Deleting the account empties the object. | L |
| BB4-4 | FS | Roster view: four agents, each with its role, its last real run, what it is waiting for, and its thread. No activity is shown that the server did not record. | new `components/crew/`, `services/apiClient.ts:965-973` | An account with no runs shows "No runs yet" for each agent. | M |
| BB4-5 | BC | Jobs engine per 8.2: catalog module, quote, sign-off, invoice, pre-checkout, pay transition, run under a session cap, acceptance, delivery, refund. | new `worker/jobs/`, `services/crew/jobCatalog.ts`, `worker/telegramBot.ts:290-418,929-1009`, `worker/paymentLedger.ts:264-292` | A paid job whose check fails is refunded in full to the payer and ends `refunded`. Paying twice for one job credits once and refunds the second. A job payment never changes `sub:` in KV (asserted). Pre-checkout for a job at a stale price is refused. | L |
| BB4-6 | BC | Reconciler on the 15-minute cron: start a paid job with no run after 10 minutes; fail and refund a job running over 30 minutes; retry `refund_due`; alert on any refund waiting over an hour. | `worker/scheduledJobs.ts`, new `worker/jobs/reconcile.ts` | Each stuck state in a fixture is resolved in one pass. Two overlapping passes refund once. | M |
| BB4-7 | FS | Job surfaces: catalog (the existing hub view), order sheet with the quote and the acceptance check in plain words, status, deliverable. | `components/hub/EcosystemHubView.tsx`, new `components/jobs/`, `services/telegram/tma.ts:384-427` | The order sheet states what will be delivered, how it is checked and that a failed check is refunded. | M |
| BB4-8 | AI | Scheduled runs per 8.2, after decision 16. Remove Sentinel's re-enqueue. | `worker/crew/founderAgent.ts`, `worker/sentinel.ts:255-262` | A weekly re-audit starts once a week per verified domain and never past the plan's count. With the flag off no alarm is set. | M |
| BB4-9 | BC | Telegram selling rule (decision 9). Inside the Mini App and bot, plans and jobs are offered in Stars only; TON and Jetton options render only on web and desktop. | `components/paywall/paymentOptions.ts:38-40`, `components/paywall/PaywallModal.tsx` | In the Mini App no TON or Jetton option is rendered (helper test on the surface flag). | S |

**Order:** BB4-0; BB4-1; BB4-2; then BB4-3 and BB4-5 in parallel; BB4-4, BB4-6, BB4-7; BB4-8 and BB4-9.

**Phase BB4 double-check:** confirm no job path calls `writeSubscriptionRecord`; confirm every outbound message goes through the one send function (grep for the bot's `sendMessage` outside it); confirm a sealed run cannot reach a write tool; confirm a refund is issued to the payer id stored at payment; confirm the 55 licence keys still redeem (Zoro 2.8).

**Scripted soak:** 14 days on staging with the test bot. **Promote when:** 20 test jobs ran, of which at least 5 were forced to fail and all 5 were refunded; no job sat in `refund_due` over an hour; the owner bought and received each catalog job on staging; the owner used each agent thread for a week and no reply contained an unmeasured number. **Production:** jobs go on for the owner's account first, then all accounts, one flag per release.

---

## 9. Phase BB5 - Community (design, decision-gated)

Not a work order. Each part names its decision and its trigger. With 5 production accounts, a public leaderboard or a demo day would be empty; each part ships when there are people to fill it.

### 9.1 Principles

- **Only server-attested events count.** A quest, a ladder level, a board position or a chat entry is earned by something the Worker recorded: a server run, a "no longer found" re-check, a verified domain, a delivered job. Never by a client flag, a tap or a visit.
- **Counts, not scores.** "4 verified fixes this month" is a count anyone can check. No composite number, no percentage, no decay.
- **Nothing to cash out.** No balance, no price, no conversion. This is what made token games lose their users after the payout, and it is what keeps the feature outside stored-value and securities questions.
- **Public means opt-in.** A handle, a project page and a feed entry are each published by the founder.

### 9.2 Parts

| Part | What it is | Built on | Needs | Trigger |
|---|---|---|---|---|
| BB5a Gated builders chat | One Telegram group. The bot issues a join-request link; a request is approved when the requester's account has one verified ship or a paid plan. No automatic removal in the first version. | TN8's gated groups; `chat_join_request` | Decision 8; bot rights `can_invite_users` | Launch cut |
| BB5b Ladder and quests | The Visibility Level ladder extended with levels earned by counts of receipts (first server audit, first verified fix, verified domain, connected Search Console, first delivered job). Quests are the next uncompleted step, shown one at a time. | `user_progression`, `trust_receipts`, BB2-9 | Decision 5 confirmed; TN1 on | BB2 in production |
| BB5c Badges | Each ladder step is a signed receipt with a public verify page and a share card. Verifiable offline, revocable, free, no wallet needed. | TN1 receipts, `/verify/r/<id>` | New receipt issuers for `audit_run` and `fix_retested` | BB5b |
| BB5d Project pages | TN3's public profile with project fields: problem, what I built, demo link, team. Server-rendered meta for crawlers. | TN3 | TN2 on; TN decision D7 | 10 verified domains |
| BB5e Build-in-public feed | TN5's proof feed. A ship note may be published into it labelled "Self-reported. Luminara did not verify this."; a verified fix carries its receipt. | TN5, `ship_notes.visibility` | Report queue and admin roles first | BB5d |
| BB5f Share cards | A prepared Telegram message and a story card for a badge or a verified fix, carrying the existing invite link. | `savePreparedInlineMessage`, `shareMessage`, `shareToStory` | Mini App Bot API 8.0 | BB5c |
| BB5g Polls | One account one vote, a unique row per poll and account, eligibility as in BB5a, results labelled advisory. Votes move on account link. | new tables at re-baseline | Moderation | 50 members in the chat |
| BB5h Board and Builder of the Month | A monthly list ordered by verified fixes, opt-in; a poll picks Builder of the Month. Recognition only: no Stars, no prize pool. | BB5b, BB5g | Decision 17 | 50 accounts with a verified ship in a month |
| BB5i Demo Day | A monthly voice chat; presenters are picked from project pages. | Telegram, BB5d | Decision 17 | BB5h |

**Moderation comes first.** No user-written text is public before a report route, a rate limit, an admin queue and named admin identities exist. Today there is one shared admin secret (`worker/adminAuth.ts:15-40`); that is not enough for a moderation log.

**Invite squads** from the brief are the existing two-sided invite (two hosted scout credits each, paid on the referred account's first real scout). A group quest is not designed here.

---

## 10. Phase BB6 and parked work (design, decision-gated)

### 10.1 Desktop runner

The desktop plan locks "The desktop client is not a second product". These are capabilities of the same product that need a desktop.

| Capability | Why desktop | Needs |
|---|---|---|
| Signed installer | Unsigned installers trigger warnings; no new capability ships unsigned | Decision 20 |
| Native approval and result notices | Web and desktop users have no push channel | One new IPC method; BB1-8 |
| File and folder ingestion into the brain | A browser cannot watch a folder | IPC for a picker and watcher; text extracted locally; upload capped; BB3 |
| Local model for private drafts | The path to a local Ollama already exists | A setting; drafts never leave the device unless saved |
| Local runner | Some jobs need the founder's own logged-in browser session and network address | The server queue stays the source of truth; the desktop claims a browse job; `browse_goal` stays approval-gated and sealed |

### 10.2 Wallet link and on-chain badge pilot

- **Wallet link.** Link a TON wallet to an existing account by `ton_proof`: a single-use server nonce, signature check, domain allowlist (the manifest names `www.luminarasuite.com` while the app may load from the apex), freshness window, public key matched to the address, and a separate network check. It is not a third way to sign in: free wallets would farm invite credits.
- **Badge pilot.** Only after decision 19. Testnet only. Standard TEP-85 code with pinned hashes and a deployments file, on the LORA plan's pattern. The owner's wallet is collection owner and authority and signs every mint from a local page; no key is ever online. A badge commits to its type, the hash of the signed receipt payload, the key id and a verify URL; never a Telegram id or a private domain, because chain data cannot be deleted. The receipt's `revoked_at` stays the source of truth.
- **`CitationRegistry.tolk`** is not used. It is not a badge contract, it is superseded by Zoro, and it has replay and key-rotation defects recorded in the blockchain audit.

### 10.3 Parked, with the conditions to reopen

| Item | Why parked | Reopen when |
|---|---|---|
| Marketplace between users; human bounties | Being the party that releases payment between two users is custody or arranging (TN 0.3, spec 0015). Stars cannot be paid out. | TN decisions D4 and D5 are answered after legal review |
| TON or LORA escrow contract | New audited contract code; no dispute path without an arbiter; LORA is not deployed | Launchpad mainnet gates pass |
| Paid bounties in chat (XMTP pattern) | Same as above; XMTP has no Telegram SDK | A non-custodial design passes legal review |
| Spendable points, staking, token rewards | Locked non-goals; decision 5 | A new owner-approved spec |
| LORA checkout | LORA rule J5 | The conditions in the LORA plan |
| Vector search | Decision 13 | Measured recall after BB3 shows typed retrieval missing facts |
| Third-party agents selling through Luminara | TN6 keeps jobs first-party | TN decision D5 |

---

## 11. Cross-plan ownership and edits

One separate docs PR (BB0-20) carries these edits, because other sessions work in those files.

| Topic | Owner | Edit to make |
|---|---|---|
| Server-side audit execution | This plan, BB2 | Verifiable-flow section 9: "V6 is specified and scheduled as Track BB phase BB2." |
| Run ledger tables | Verifiable-flow V2 | None. BB2 writes through V2's tables and adds `crew_runs`, `crew_run_steps`. |
| Privacy and account-link lists | This plan, BB0-17 | Verifiable-flow V2-1b and V3-1b, Allora CL1-1: "Register the table in `worker/accountTables.ts` instead of editing the lists." |
| Findings hydration from the server | Shared: BB1-5 and verifiable-flow V2-9 | Both name the other; the first to land owns it |
| Hosted model call | Zoro P1-4 starts it; BB2-3 completes it | Zoro P1-4: "Becomes `worker/llm/hostedLlm.ts` in Track BB." |
| Fetch wrapper | Allora CL0-3 | None. BB2 adds fencing and retention on top. |
| Server re-check strings | Allora 3.5 | None. BB2-9 reuses them. |
| Approvals | Oracle-ops F1 | F1: "Telegram approve and deny buttons are Track BB BB1-7 and call the same decide function." |
| Beacon push opt-in | Oracle-ops F2 | F2: "Opt-in and caps live in D1 `notify_prefs` (Track BB BB4), not KV. Until BB4, Beacon push stays off." |
| Scheduled user work | Oracle-ops "Parked" | "Watches: read-only recipes are scheduled by Track BB BB4-8 under decision 16; all other Watches stay parked." |
| Session caps | Spec 0016 K1 | K1: "The per-run cap in `crew_runs.cap_cents` is the first-party slice of the session cap and uses the same enforcement function." |
| Agent Jobs | Trust-network TN6 | TN6: "Specified in Track BB section 8; the migration `agent_jobs` is created there." |
| Gated groups | Trust-network TN8 | TN8: "One builders chat is un-parked by Track BB decision 8 as BB5a." |
| Retired shell and Sentinel re-enqueue | This plan | None outside this plan |
| Deploy workflow | Oracle-ops Phase 0 and BB0-14 | Oracle-ops Phase 0 item 7: "Dispatch scoping, concurrency and the bookmark step are BB0-14." |

---

## 12. The gamified draft: what is taken and what is corrected

Taken: the aim of a daily reason to return; weekly missions tied to real work; share cards with the invite link; a build-in-public feed; badges for verified milestones; a builders group; no token airdrop.

| Draft claim | Problem | This plan |
|---|---|---|
| "Lumens" balance, earned and burned | A visible, spendable balance is what `specs/0009` rejects; a spendable balance is stored value | Counts and a ladder (9.1); decision 5 |
| Daily check-in and streak bonus | Tap-to-earn; rewards opening the app, not shipping | A calendar strip that earns nothing; decision 6 |
| "AI Visibility Index", "+8.4% AI Citation Velocity this epoch", "visibility decay" | No server-measured weekly citation series exists; a decay with no measurement is an invented metric | Statuses, dates and measured Google numbers only |
| Daily 10:00 standup and Sunday reminder to all users | `specs/0009` Decision 6; a bot cannot message a user who did not start it | Opt-in transactional notices; decision 7 |
| Upvote weight by level; "stake Lumens" | Staking is a locked non-goal; weighted votes are not one person one vote | One account one vote (BB5g) |
| Telegram Stars "micro-escrow" with a 5 to 10% fee and a payout webhook | No Bot API method pays Stars to a user; Stars in the bot's balance are Luminara's custody; spec 0015 caps any fee at 5% and needs counsel | First-party jobs with a full refund (8.2) |
| Demo Day vote in Stars with a prize pool | Paid votes are pay-to-boost; a participant-funded pool is a new regulated shape | Recognition only (BB5h) |
| Agency lead marketplace | "No marketplace" is locked; TN6 allows first-party jobs only | Agent Jobs |
| Badges "stored in `CitationRegistry.tolk`", minted to a wallet "linked to their Telegram ID" | That contract is not a badge contract and is superseded; no wallet link exists; it would publish an identity link that cannot be deleted | Signed receipts first; a testnet pilot behind decision 19 |
| "100% compliant", "Zero Howey Risk", "Immune to SEC securities scrutiny" | Legal absolutes with no review behind them; the repo's posture is AU and NZ and awaits counsel | No such claim anywhere |
| Dependency on D1 `referral_progress` | The table does not exist; the tables are `user_progression`, `user_missions`, `referral_rewards` | Cited correctly in 1.1 |

---

## 13. Reference projects

Checked on 2026-10-10 by loading each site and repository. "Pattern" means the idea is written independently; "code" means the licence allows copying with its notice into this AGPL-3.0 repo. Nothing in this plan copies code.

| Project | Link | Licence | What this plan takes | Use |
|---|---|---|---|---|
| Busabase | github.com/busabase/busabase | MIT; sign-in, roles and API keys are paid add-ons; three and a half months old | Agent writes land as reviewable changes on a shared record store (BB3-7) | Pattern |
| Kaneo | github.com/usekaneo/kaneo | MIT | A lean task board over existing records (BB1) | Pattern |
| Memos | github.com/usememos/memos | MIT; Go | One-line capture on a timeline (BB1) | Pattern |
| BookStack | codeberg.org/bookstack/bookstack (GitHub is a mirror) | MIT; PHP | A fixed hierarchy of public pages (BB1-10) | Pattern |
| LangGraph JS | github.com/langchain-ai/langgraphjs | MIT | A checkpoint after every step, resume on failure (BB2) | Pattern; Workflows provides it natively |
| OpenAI Agents SDK for TypeScript | github.com/openai/openai-agents-js | MIT; tracing goes to OpenAI by default | A tripwire guardrail on output (BB2-5) | Pattern |
| CrewAI | github.com/crewAIInc/crewAI | MIT; Python | A reviewer role that checks claims before they ship (Verifier) | Pattern |
| Pydantic AI | github.com/pydantic/pydantic-ai | MIT; Python | Typed outputs with retry (BB2-4) | Pattern |
| AutoGen paper | arxiv.org/abs/2308.08155 | n/a | Background reading on agent conversation | Reading |
| Cloudflare Agents SDK | github.com/cloudflare/agents | MIT; pre-1.0 | One Durable Object per agent with its own storage and schedule (BB4) | Dependency, behind an adapter, if BB4-0 passes |
| OpenMausBot | github.com/milind-soni/OpenMausBot (site moved to mausbot.com) | Apache-2.0; `enterprise/` is source-available only | An inline Allow or Deny card for each risky action (BB1-7) | Pattern |
| OpenDots | github.com/CopilotKit/OpenDots | MIT template; needs CopilotKit's hosted service to run | Read-only tools run alone, anything else waits for approval | Pattern |
| OpenClaw | github.com/openclaw/openclaw | MIT | Telegram as the front door to an agent (BB4) | Pattern |
| Hermes Agent | github.com/NousResearch/hermes-agent | MIT; Python | Memory that feeds the next run (BB3) | Pattern |
| OpenWorker | github.com/andrewyng/openworker | MIT; Python | Every task ends in a deliverable with an action log; an approval ladder (BB2, BB4) | Pattern |
| Zealy | zealy.io, docs.zealy.io | Closed | Quests as the next concrete step (BB5b) | Pattern |
| Galxe | github.com/Galxe/protocol-whitepaper | MIT (white paper) | Credentials that prove what someone did (BB5c) | Reading |
| Guild.xyz | docs.guild.xyz | Main repo has no licence | Rule-based entry to a chat (BB5a) | Pattern only; nothing may be copied |
| Devfolio | devfolio.co | Closed | Project page layout (BB5d) | Pattern |
| Speedrun Ethereum | speedrunethereum.com | MIT | A graded path where each step unlocks the next (BB5b) | Pattern |
| Notcoin | notcoin.org (the GitBook link supplied was a different project) | n/a | Invite mechanics; a warning about what follows an airdrop | Reading |
| Hamster Kombat | hamsterkombat.io/docs/HK_WP_03.pdf (September 2024) | n/a | Same | Reading |
| TON | docs.ton.org; TEP-85, TEP-62 | n/a | `ton_proof` wallet link; soulbound standard (BB6) | Standard |
| TON Society | github.com/ton-society | Repositories archived; grants paused | Nothing. The "apply for ecosystem support" advice is stale. | None |
| Gitcoin | gitcoin.co/mechanisms/quadratic-funding; passport.human.tech | AGPL-3.0 (dormant code) | One person one vote as a goal (BB5g) | Reading |
| XMTP | docs.xmtp.org; github.com/xmtp/libxmtp | MIT; the litepaper repo is archived | Payment requests in chat, parked (10.3) | Reading |
| Farcaster, Lens, Status, Mastodon, Bluesky | farcaster.xyz, lens.xyz, status.app, joinmastodon.org, atproto.com | Mixed | Reference designs for open social graphs; not needed for launch, since Telegram is the social layer | Reading |

Not to be copied: AFFiNE (backend under an enterprise licence), NocoBase (restrictive custom terms), Outline (Business Source License), any `enterprise/` directory, and any repository with no licence file.

---

## 14. Dependency graph

```
BB0-0, BB0-1 (alone) -> BB0-2..BB0-10 (small PRs)
BB0-12 (staging sign-in), BB0-13 (release plumbing) -> BB0-14..BB0-16 -> BB0-17 (alone)
   |
   +-- BB1-0 -> BB1-1 -> BB1-2..BB1-4 -> BB1-5, BB1-9
   |            BB1-10 (parallel)        BB1-6..BB1-8 (oracle-ops Phase 1 order)
   |
   +-- BB2-0 -> BB2-1 (V2-1..V2-3, CL0-3, CL0-5, Zoro P1-3b, P1-4)
   |              -> BB2-2 -> BB2-3..BB2-6 -> BB2-7 -> BB2-8, BB2-10 -> BB2-9 -> BB2-11 -> BB2-12
   |                                                                       |
   |                                         BB5a (decision 8) <-----------+   launch cut
   |
   +-- BB3-0 (start early: Google verification)
   |     -> BB3-1 (V3) -> BB3-2, BB3-3 -> BB3-4 -> BB3-5, BB3-6 -> BB3-7..BB3-10 -> BB3-11
   |
   +-- BB4-0 (needs oracle-ops Phase 2, K1, K2, TN1, TN2, Zoro Phase 2, BB2)
         -> BB4-1 -> BB4-2 -> BB4-3, BB4-5 -> BB4-4, BB4-6, BB4-7 -> BB4-8, BB4-9

BB5b..BB5i: each on its trigger (9.2).   BB6: on decisions 19 and 20.
```

| Rule | Detail |
|---|---|
| Lanes | Worker lane (BB0 fixes, BB1 Worker tasks, BB2, BB3, BB4) and front-end lane (BB1-1, BB1-5, BB1-9, BB1-10, then each phase's UI) |
| Shared files | `worker/index.ts`, `App.tsx`, `worker/telegramBot.ts` and `wrangler.jsonc` are touched by many tasks and by other sessions. One open PR per file at a time; rebase before review |
| Other plans' tasks | Where this plan adopts a task, the task keeps its own id and its own acceptance; its owner plan's log records it |
| Production | Explicit owner approval in chat for every production step. Flags stay off in production until the phase's promotion criteria are met |

---

## 15. Risks

| Risk | Mitigation |
|---|---|
| The payment defect is live while this plan is reviewed | BB0-1 ships alone, first, without waiting for any decision but 1 |
| The backlog is larger than it looks: BB2 alone needs six tasks from three other plans | BB2-1 lists them by id; the launch cut is four phases, not seven; each later phase has a trigger |
| Hosted model cost with no ceiling | Per-run cap checked before every call; weekly run counts; one cost row per run; `BUDGET_ENFORCEMENT`; kill switch; canary on the owner's account |
| An agent states a number nobody measured | Typed steps; the blocking guard; evidence refs required; stopgaps in BB0-4 to BB0-7 |
| Prompt injection from a crawled page, a Search Console query or Business DNA | Fencing at every prompt entry; sealed runs; no external write tool before F3 enforces; injection corpus in CI |
| A run hangs or half-finishes | Workflows retries and terminal states; one active run per subject; reconciler; promotion criterion on non-terminal runs |
| A founder pays for a job and gets nothing | Deterministic acceptance; full refund; reconciler with an alert; job payments never touch subscriptions |
| A Google token leaks | Encrypted at rest with a key id; redaction and secret-scan patterns; aggregates only; revoke before delete |
| A founder connects Google to an attacker's account | The typed code on a first-party page; pending tokens attach only through the starting session; single-use flow row |
| Google verification is refused or slow | BB3-0 starts first; until it completes the production flag is off and the feature is staging-only |
| Community features ship to an empty room | Triggers in 9.2; the launch cut has only the gated chat |
| Public user text is abused | Moderation before any public text; opt-in publishing; domain receipt required for a page |
| Points creep back in as "just a number" | Non-goal in 0.7; decision 5; ladder derived from receipts, which cannot be bought |
| Telegram removes the bot for selling outside Stars | Decision 9 and BB4-9 |
| A Durable Object class cannot be removed once deployed | BB4-0 spike on staging first; the class is added only in BB4 |
| A new binding is missing in one environment and falls back silently | BB0-16 |
| A new cron runs every job, or a second queue feeds the audit consumer | BB0-15 |
| A migration auto-applies with no restore point | BB0-14 records the bookmark; operator backup before any migration PR (Zoro 2.3) |
| New per-account tables are missed by deletion or account linking | BB0-17's registry and its failing test |
| Another session's uncommitted work is swept into a commit | Rule 2.2; BB0-18 |
| The Agents SDK changes under us | One adapter file; exact version pin; a plain Durable Object behind the same interface |
| Licence keys stop redeeming | Zoro 2.8 check before and after every production deploy |
| Copied code from a restricted licence | Section 13; patterns only; a notice entry the same day for any dependency added |

---

## 16. Owner and operator checklist

**You** needs the owner or an operator with Cloudflare, Telegram, Google or wallet access. **Agent** can be done in a coding session.

1. **You.** Answer decisions 1 to 4.
2. **You.** Open your wallet app and confirm the merchant address (decision 2).
3. **You.** Sign in on the production web app with email and say whether it works (BB0-11).
4. **Agent.** BB0-1, then BB0-2 to BB0-10, each as a PR to `staging`.
5. **You.** Create a staging test bot in BotFather and a staging Firebase web configuration; set the staging secrets (BB0-12, Zoro section 10 step 6). Use a fresh shell so no production token is present.
6. **You.** Read the Workers plan tier and D1 sizes from the Cloudflare dashboard (BB0-19) and run the two `migrations list` commands (BB0-13).
7. **You.** Set a required reviewer on the GitHub `production` environment (BB0-13).
8. **Agent.** BB0-13 to BB0-17.
9. **You.** Answer decisions 5 to 7 before BB1 reaches production, and 8 to 12 before BB2.
10. **You.** Before BB2-2 merges: create the two evidence buckets and confirm the Workflows binding deploys on staging.
11. **You.** Start Google verification (BB3-0) as soon as decision 14 is yes.
12. **You.** Give the builders chat bot `can_invite_users` (BB5a).

Nothing is deployed to production without an explicit yes in chat.

---

## 17. Immediate next actions

1. Owner: decision 1, and the wallet confirmation.
2. Agent: BB0-1 as its own PR (a task chip for it was raised on 2026-10-10).
3. Agent: BB0-3, BB0-4 and BB0-5, the three honesty fixes with no dependency.
4. Operator: BB0-12, so every later phase can be tested signed-in.
5. Owner: start decision 14's Google verification in parallel; it is the longest lead in the plan.

---

## 18. Review record

| Round | Reviewers | Verdict | Outcome |
|---|---|---|---|
| 0 | Eight read-only specialist audits on 2026-10-10: backend and data, AI and agents, blockchain and payments, front end and desktop, deploy and security, existing plans, reference links and licences, platform facts | Input, not a verdict | Folded into sections 0 to 13 |
| 0 | Author's SQL check: all four migrations in this plan applied to an in-memory SQLite 3.51.3 built from the 23 files in `migrations/` in wrangler order, with and without verifiable-flow's `run_ledger` and `scoped_memory`; 51 behavioural checks | 51 of 51 pass | Notes under each migration |
| 1 | Pending: full-stack, AI and machine learning, blockchain, a citation and SQL verifier, and a CEO gate | | |

---

## 19. Execution log

Empty. No task has started.
