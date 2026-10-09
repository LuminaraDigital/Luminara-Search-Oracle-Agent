# Oracle Operations Layer: production ship plan

Status: **scope agreed (Phase 0 to 2), not started. Nothing in this plan is implemented. Starts after the SMB Launchpad work lands.**
Audience: CEO / staff eng / deploy operator / on-call
Reference corpus: `paperclipai/paperclip` @ `569c720` (shallow clone in the OS temp dir, outside this repo, read-only). Earlier pattern work used `53aad90b9` (see `paperclip-pattern-production-ship.md`).
Brand: Luminara only. Feature names: Sign-off Desk, Beacon, Sealed Lane, Agent Seats (CEO-approved).
Review record (2026-10-04): loop 1 ran three read-only specialist passes (approvals and feed hooks, containment and seats hooks, deploy hazards) against the current tree; loop 2 was a cold principal-engineer review that found 3 blockers, 10 majors, 12 minors. All are folded in below. Every hook point named here was checked in code.

## 0. Assumptions

1. "Take everything from Paperclip" means: adopt its useful ideas as new Luminara capability, implemented independently. It does not mean copy, rename, and disguise (section 1 explains why disguise raises risk).
2. "Additive" means: new files, nullable columns, new tables, existing routes extended, all behind flags that default off. No rewrite of `worker/mcpServer.ts`, `worker/budgets.ts`, `worker/mcpGovernance.ts`, payment, TON, or redemption.
3. This plan extends `paperclip-pattern-production-ship.md` (specs 0009 to 0014). Where they conflict on current deploy facts, this plan is newer (section 7).
4. SLO and alert thresholds are proposed targets, not measurements. Capacity is measured on staging, not guessed.

## 1. Legal position

This is an engineering reading, not legal advice. Counsel review is open decision 5.

Verified this session: Paperclip's root `LICENSE` is MIT, Copyright (c) 2025 Paperclip AI. Nested `LICENSE` files (`packages/adapters/hermes`, `packages/shared/src/cliplab`, `ui/public/brands/adapters`) are MIT. Every `package.json` license field found is `MIT`. No `ee/`, `enterprise/`, or `commercial/` directory exists. Their docs mention an EE policy editor; it is not in the checkout and is out of scope.

1. MIT permits reuse, modification, and sale, provided the copyright and permission notice travel with copies or substantial portions.
2. Stripping that notice from copied code is the breach. Renaming copied code to hide it makes the position worse.
3. MIT grants no trademark. Never use the Paperclip name, logo, banner, taglines, or brand icons.
4. Ideas are not licensed. Approval queues, attention feeds, containment presets, and scoped agent identities are free to reimplement.
5. Their stack (Node, Postgres, Drizzle) does not run on ours (Worker, D1, KV). Independent implementation is also the cheapest path.

Policy ("clean-room light"): no file copy, no line-by-line translation; specs written from our domain and observed behavior; a provenance doc maps each feature to its inspiration; any snippet ever copied gets a `THIRD_PARTY_NOTICES.md` entry the same day.

## 2. Requirements checklist

1. Additive to what Luminara has; reuse existing governance, budgets, provenance, audit, RBAC.
2. Customized for Luminara: our names, schema, UI, and search/citability domain.
3. Reduce legal exposure (sections 1, 5, Phase 0).
4. Luminara brand, APS invariants, honesty labels (`measured | estimated | not_measured`), no em dashes.
5. Production and deployment ready: release checklist, flag matrix, kill switches, rollback, SLOs, alerting with a mechanism, canary, runbook, threat model, privacy, test plan.
6. Grounded in the current code.
7. Decisions recorded; open decisions listed.

## 3. What already exists (verified)

| Area | Already shipped | Real gap |
|---|---|---|
| Approvals | `mcp_action_requests` has `status`, `decided_by`, `decided_at`, `expires_at`, `kind`. Routes `GET /api/mcp-action-requests` and `POST /api/mcp-action-requests/:id/approve|deny` exist with owner check, 404/403/409, audit actions `mcp_action_approve|mcp_action_deny`, tests in `tests/mcpActionRequestsHttp.test.ts`. Budget resume is self-service at `POST /api/budgets/self/resume`. | No UI. `decide` does not check `expires_at`. No per-account rate limit on approve/deny. **Approvals are not bound to arguments or requester:** `hasApprovedRequest` matches only (account, tool, project) and is reusable until the 30-minute TTL; `createActionRequest` dedupes a new call onto an existing pending row that holds the first call's args. So a human who approves one `browse_goal` call approves any `browse_goal` args for that account and project for 30 minutes. This is a live weakness today, not only a future one. |
| Alerts | `budget_incidents` (deduped) plus `budget_soft_alert` audit in `mcpServer.ts`; Sentinel drift sends `sendTelegramAlert` to Telegram-sourced owners. Only cron is daily `0 8 * * *`. | No unified, acknowledgeable feed. Firebase-only users get no push. No sub-daily alert mechanism. |
| Injection defense | `utils/untrustedContent.ts` fencing, Oracle system rule, DO-preferred history, explicit tool confirm (`oracleInteractionGuard.ts`), output monitor, fenced memory RAG. | No trust ceiling on follow-on tools. Client `services/tools/runToolLoop.ts` folds tool output into the next prompt unfenced. MCP has no cross-call state (`mcp-session-id` is only a CORS header). Stored rows (reports, research log) carry no origin trust. |
| Agent identity | `lm_live_*` resolves to `HostedIdentity { id: 'apk:{keyId}', accountId }`. | Account-wide power per key. `HostedIdentity`, `McpToolContext`, and `cost_events` carry no seat or key id. `budget_policies.scope_type` CHECK allows only `account|project`. `planEntitlements.teamSeats` means human seats. |
| Deploy | `deploy-cloudflare.yml` applies D1 migrations before deploy in both envs; smoke has a D1 table preflight (`REQUIRED_D1_TABLES`). | Preflight runs after deploy; prod job has no `needs:` on staging; deploy skips lint/tokens/coverage/evals; flags need a redeploy; `validate-env.mjs` checks no feature flags; deploy uses `wrangler deploy` (no gradual rollout); `handleMcpRequest` receives no `ExecutionContext`. |

## 4. Features

All four share: flags parsed by one helper (`worker/featureFlags.ts`, Phase 0), declared in `worker/env.ts` (and `UserStoreEnv` in `worker/userStore.ts` when read by governance or budgets), explicit value in all three `wrangler.jsonc` vars blocks, unset means off, KV override (section 8), Sentry tag `feature:<name>`, per-folder README invariant update.

### F1. Sign-off Desk (approvals UI, binding, hardening)

Extends the existing `/api/mcp-action-requests` API. No parallel `/api/signoffs` routes.

- **Migration (expand-only):** nullable `args_hash TEXT`, `trust TEXT`, `requested_by TEXT`, `consumed_at INTEGER` on `mcp_action_requests`. Existing rows read as null and keep today's semantics.
- **Approval binding (fixes the reuse weakness):**
  1. New requests store `args_hash` (SHA-256 of canonical redacted args), `requested_by` (`apk:{keyId}` or human user id), and `trust` (`standard | sealed`).
  2. `createActionRequest` only dedupes onto a pending row with the same `args_hash`, `requested_by`, and `trust`.
  3. Sealed calls and seated callers require a matching approval (`args_hash`, `requested_by`, `trust='sealed'` where sealed) and consume it once: `UPDATE ... SET consumed_at = ? WHERE id = ? AND status = 'approved' AND consumed_at IS NULL AND expires_at > ?`, proceeding only when one row changed.
  4. Standard approvals never satisfy sealed calls. Approving never changes a run's trust.
  5. Standard unseated calls: decision 8 (recommended: same args binding and single use for all `destructive` tools; keep multi-use only for `write`).
- **Hardening:**
  1. Route checks `row.expires_at` before `decide` and returns 410 `code: 'EXPIRED'`; `decide` also adds `AND expires_at > ?` as a race guard.
  2. List returns derived `effectiveStatus` (`pending | approved | denied | expired | consumed`) and an `argsSummary`. Keep `args_json` in the response for one release (already redacted at insert), mark deprecated, then remove.
  3. Sign-off Desk lists `kind='tool'` only; budget resumes are shown read-only with a link to the budget resume flow.
  4. Approve/deny call `enforceDualRateLimit` (`worker/securityHardening.ts`), 30/60s per account plus IP.
  5. Invariant test: approve/deny reject `lm_live_*` and MCP OAuth bearers. Today `identify` accepts only session cookie, Firebase Bearer, and Telegram initData. Limitation, documented: an agent driving the user's own browser session looks identical to the human (decision 9 covers step-up confirmation).
- **UI (new):** `components/signoff/SignoffDeskView.tsx` via `workerFetchWithAuthRetry` from `services/apiClient.ts`. Shows tool, risk, trust, requester (seat label or "you"), project, args summary, countdown to expiry, approve/deny.
- **Deferred (decision 6):** org `canManageOrg` approvers, member-scoped list query, and index.
- **Flag:** `SIGNOFF_DESK` gates UI and binding writes. Turning it off must not break the existing routes; consume semantics for sealed and seated calls are owned by `SEALED_LANE` and `AGENT_SEATS` and stay on if those are on.

### F2. Beacon (attention feed)

- **Schema (new migration):** `beacon_events(id, account_id, source, kind, severity, title, detail_redacted, target_id, dedupe_key UNIQUE, created_at, acknowledged_at, expires_at)`. `dedupe_key` includes a window: `budget:{account}:{window}:{threshold}`, `signoff:{requestId}`, `drift:{target}:{day}`, `run_failed:{account}:{hour}`. Index `(account_id, acknowledged_at, created_at DESC)`.
- **Emit:** `emitBeacon(env, event, ctx)` in `worker/beacon.ts`, `INSERT OR IGNORE`, scheduled through `ctx.waitUntil`. Prerequisite (Phase 1 first task): pass `ExecutionContext` into `handleMcpRequest` and `McpToolContext`; where no context exists (cron), await with a 500 ms timeout. Failures report to Sentry with `feature:beacon`.
- **Producers:** `recordBudgetIncident` / `evaluateSoftAlerts` in `worker/budgets.ts`; `createActionRequest` in `worker/mcpGovernance.ts` only when it returns `existing: false`; `runSentinelScan` in `worker/sentinel.ts` at the `needsAlert` branch; `completeRun` with status `failed`.
- **Read:** `GET /api/beacon?since=` (cursor, max 50), `POST /api/beacon/:id/ack` with dual rate limit. UI polls at 60 s or slower and pauses when the tab is hidden.
- **UI:** `components/beacon/BeaconStrip.tsx` in `components/suite/DashboardView.tsx` next to `HomeCtaStrip`. Dashboard makes no `/api` call today, so this is its first hosted fetch; guest/local mode renders nothing.
- **Push:** Telegram only for accounts with a known chat id, opt-in stored as KV `beacon:tg_optin:{accountId}` (default off), max 5 per account per day, text through `logRedaction`, never tool args.
- **Honesty:** detail states what was measured; missing values stay `not_measured`.
- **Retention and privacy:** add `beacon_events` to the delete list and export in `worker/privacyService.ts`. Purge rows whose `acknowledged_at` or `expires_at` is older than 30 days inside the existing `privacy_purge` job.
- **Flag:** `BEACON=off` stops emit, push, and UI, and the read/ack routes return 404.

### F3. Sealed Lane (low-trust containment)

Highest security value. Luminara ingests hostile web content by design.

- **Untrusted ingest set (verified tool names):** `browse_observe`, `browse_act`, `browse_goal`, `get_serp_results`, `get_pagespeed_summary`, `get_visibility_snapshot`; client `live_search` and Tavily grounding. Provider-data tools (`get_domain_overview`, `get_backlinks_overview`, `research_keywords`) are `standard`; revisit if a provider starts returning page text.
- **Ceiling when sealed:** `read` allowed; `write` requires a bound, single-use Sign-off (F1); `destructive` denied. Per-tool `sealedAllowed: true` in `TOOL_GOVERNANCE` for `research_keywords` (own research log; capped at 5 calls per sealed run) and `browse_close` (teardown must stay possible).
- **Governance hook:** `decideToolCall` gains optional `trust` in `PolicyContext`. Absent means `standard`, so existing callers and tests are unchanged.
- **Effective trust for an MCP call (strongly consistent, no KV):** the most restrictive of
  1. the tool's own class (untrusted ingest tool means sealed),
  2. the parent run's stored trust, when `parentRunId` is given,
  3. account recency: `SELECT 1 FROM run_provenance WHERE account_id = ? AND trust = 'sealed' AND started_at > ?` (15 minutes), served by the existing `(account_id, started_at)` index. Scope is the account, not the project.
  A parent can only tighten trust, never loosen it, so passing a clean parent cannot escape recency.
- **Write trust at start, not completion:** `startRun` receives trust computed from the tool class before the handler runs, so a concurrent child never reads null.
- **Parent handling:** accept `luminara-run-id` header (add it to the `MCP_CORS` allowed headers) or `parentRunId` argument, stripped from `args` before audit, approval hashing, and the handler. Validate with a SELECT (same account) before insert, because `parent_run_id` has a foreign key and a bogus id would make `startRun` fail and return null. Foreign or unknown parent: treated as sealed.
- **JSON-RPC batch:** `handleMcpRequest` loops over messages; trust carries forward in memory across the batch, so once any message is sealed, later messages in the same request are sealed.
- **Provenance failure:** if `startRun` returns null under `enforce`, compute trust from tool class plus account recency; if that query also fails, treat as sealed.
- **Laundering through stored rows:** add nullable `origin_trust` to `agent_reports` and `project_research_log` (verify table names at implement time). Rows written by a sealed run are `sealed`. `get_report`, `get_project_context`, and research-log reads fence those rows with `wrapUntrustedContent` and seal the reading run.
- **In-app Oracle (advisory, human-driven):** the `OracleSession` DO (`worker/oracleSession.ts`) stores a `trust` key. It becomes sealed when the server fences a result from the untrusted set or the client reports untrusted evidence (`live_search`, browse). A sealed session skips `extractFactsFromChat` auto-store (defined in `worker/memoryRag.ts`, called from `worker/oracleChat.ts`) and fences replayed assistant history. When the DO is unavailable, client-supplied history is treated as untrusted. A user starting a new session resets trust; accepted because a human is in the loop, documented.
- **Client quick win (ship first, no flag):** fence every tool output in `services/tools/runToolLoop.ts` and `live_search` evidence in `services/geminiService.ts` with `wrapUntrustedContent`.
- **Schema:** nullable `trust TEXT` on `run_provenance`, nullable `origin_trust` on the two content tables (expand-only, no REFERENCES). Pre-existing rows are null and read as `standard`; they predate the feature.
- **Modes:** `SEALED_LANE = off | observe | enforce`. `observe` writes audit action `sealed_lane_would_block` (redacted) and blocks nothing. Run observe on staging, then production for at least 14 days. Promote to `enforce` only when every would-block on a legitimate flow has been reviewed and resolved by adjusting the tool list.
- **Fail semantics:** missing `trust` column (pre-migration) fails open to `standard` and reports to Sentry, consistent with H1. Every other trust uncertainty under `enforce` resolves to sealed.

### F4. Agent Seats (scoped API keys)

- **Schema (new migration):** `agent_seats(api_key_id TEXT PRIMARY KEY REFERENCES api_keys(id) ON DELETE CASCADE, account_id, label, risk_ceiling CHECK IN ('read','write','destructive'), tool_allowlist_json NULL, monthly_cap_cents NULL, created_at, updated_at)`. Insert only via `INSERT ... SELECT FROM api_keys WHERE id = ? AND account_id = ?` so a seat cannot attach to another account's key. Nullable `seat_id TEXT` on `cost_events` plus index `(account_id, seat_id, created_at)`. The `budget_policies.scope_type` CHECK is not changed. Add `agent_seats` to privacy delete and export.
- **Resolution:** `identifyApiKey` yields `apk:{keyId}`; the MCP path loads the seat once into `McpToolContext.seat` (not on `HostedIdentity`).
- **Gate order inside `callTool`:** budget halt, then seat ceiling and allowlist, then approval lookup, then `decideToolCall`. An approval can never lift a seat ceiling. For seated callers, approval lookup filters on `requested_by` (F1), so one seat's approval cannot be used by another key. A seat block returns `code: 'SEAT_BLOCKED'` and audits `mcp_tool_block` with `reason: 'seat_ceiling'`, `actor_type: 'seat'`.
- **Cost attribution:** pass `seatId` and the existing MCP `runId` into `recordCostEvent` (today `runId` is not passed).
- **Two flags:** `AGENT_SEATS = off | observe | enforce` controls ceiling and allowlist only. `AGENT_SEAT_CAPS = off | observe | enforce` controls monthly caps. Production `BUDGET_ENFORCEMENT` is `hard` today while the prior plan required invoice reconciliation before hard stops, so only `AGENT_SEAT_CAPS=enforce` waits on decision 7.
- **Fail semantics:** missing `agent_seats` table means no seat (today's behavior). For `apk:` callers, any other seat lookup error fails closed for that call. No KV cache in Phase 2, so revocation is immediate.
- **Entitlement:** new `agentSeatLimit` in `services/plans/planEntitlements.ts` and the Worker mirror `planCapsFor` in `worker/telegramBot.ts`. Do not reuse `teamSeats`. Values are decision 4.
- **UI:** seat fields on the existing API key management surface in Settings.

## 5. Naming and differentiation

- Never use: `Paperclip`, `@paperclipai`, their taglines, the four-pillar framing, the "company / hire / org chart of agents" metaphor, their logos, banner, or SVGs.
- Our own table names, route names, enums, layouts, and copy, tied to search and citability.
- Agent output already bans the word (`BANNED_VENDORS` in `scripts/honesty-gates-lib.mjs`, vendor list in `worker/agentOutputValidators.ts`). Keep both.
- Repo guard: `scripts/check-forbidden-tokens.mjs` has no path scoping, and `paperclipai/` already appears in four committed plan docs plus this plan. Adding the token as-is breaks CI. Phase 0 adds per-token path scoping (`token @paths=worker/,services/,components/,utils/`) with a test, then adds `@paperclipai`, `paperclipai/`, `PAPERCLIP_` scoped to code paths. Never add bare `paperclip`.

## 6. Phases

A production release changes code or exactly one flag state, with at least 24 hours between flag changes in production. KV flips count as releases for this rule.

### Phase 0: Hygiene and release plumbing (no user-visible change)

Legal and provenance:
1. `docs/ops/PATTERN-PROVENANCE.md`: feature, inspiration concept, what was written independently, reference commit `569c720`.
2. Paperclip bullet in the existing "Research inspiration (clean-room; no upstream code vendored)" section of `THIRD_PARTY_NOTICES.md`.
3. Forbidden-token path scoping and scoped tokens (section 5).
4. Re-run `rg -i -l paperclip` outside `docs/` and `specs/`. Expected hits only: `AGENTS.md`, a comment in `worker/budgets.ts`, `worker/agentOutputValidators.ts`, `scripts/honesty-gates-lib.mjs`, `tests/agentOutputValidators.test.ts`. Any other hit is a stop condition.

Release plumbing (prerequisite for every later phase):
5. Smoke `--preflight-only` mode run between migrate and deploy in `deploy-cloudflare.yml`. Prod probe passes `--env production`; match exact table names instead of substrings; add `0018` and each new migration and table to `REQUIRED_D1_MIGRATIONS` / `REQUIRED_D1_TABLES`.
6. Migration lint in CI: reject `DROP` and `RENAME`; in `ALTER TABLE ADD COLUMN`, reject `NOT NULL` without a default and any `REFERENCES` column with a non-null default (SQLite rule with foreign keys on); reject new duplicate numeric prefixes (allow-list the existing `0011`, `0012`, `0013` pairs).
7. Deploy gating and rollout: production job `needs:` the staging job; GitHub `production` environment requires a reviewer (APS: no production deploy without explicit operator approval); run tokens check and lint in deploy. Code canary: switch to `wrangler versions upload` plus `wrangler versions deploy` (10% then 100%) after a staging test confirms gradual deployment works with the `ORACLE_SESSION` Durable Object binding; if it does not, drop the code canary and rely on account-allowlist flag canaries.
8. `worker/featureFlags.ts`: one parser (`off|on` or `off|observe|enforce`, unset means off); KV override `flag:{NAME}` with 30 s in-isolate cache; account allowlist `flag:{NAME}:accounts` (JSON array) for canaries; KV fallback rule: on missing binding or read error, use the last good cached value, else the wrangler var, never silently `off` for a flag currently in `enforce`. Tests for each path. `checkFeatureFlags` in `scripts/validate-env.mjs` for presence and allowed values in all three vars blocks. Add `LAUNCHPAD_ENABLED` to all three vars blocks with its own existing `true|false` parser (do not move it to the new parser).
9. Alert mechanism: a mapped `*/15 * * * *` cron in `worker/scheduledJobs.ts` and `wrangler.jsonc` (both together; an unmapped cron runs every job) owning a new `ops_alerts` job that queries D1 and audit rows and reports to Sentry. Add Sentry reporting to the `scheduled` handler.
10. Confirm remote migration state: `npx wrangler d1 migrations list luminara-users-staging --remote --env staging` and `npx wrangler d1 migrations list luminara-users --remote --env production`. Commit `0018` before any feature migration.
11. Commit this plan file.

Exit: CI green with new lint, token scoping, and flag tests; staging deploy runs preflight before deploy; a KV flip of a dummy flag takes effect on staging without redeploy; `ops_alerts` cron fires on staging. Rollback: revert PRs; no runtime data touched.

### Phase 1: Sign-off Desk and Beacon

Order: `ExecutionContext` plumbing into MCP; F1 migration and binding; F1 hardening; F1 UI; F2 migration, emit, read; F2 UI; F2 retention.

Staging drill:
1. `browse_goal` from MCP returns `requiresApproval` and `actionRequestId`; a Beacon item appears within one poll.
2. Approve in the Sign-off Desk without SQL; retry with the same args within TTL; it executes.
3. Retry with different args: a new request is created; the earlier approval does not apply.
4. Let another request expire; UI shows expired; approve returns 410.
5. Approve with an `lm_live_*` key: rejected.
6. Cross a soft budget threshold on a dogfood account: one Beacon item, deduped on repeat; ack; next window re-fires.
7. Privacy delete for the dogfood account removes its `beacon_events`.

Production: two separate releases (`SIGNOFF_DESK`, then `BEACON` after 24 hours), each dogfood allowlist first, then all accounts.

Exit: drill green; on-call approves a destructive request in under 60 seconds without SQL; Beacon emit error rate under 0.1% over 7 days on staging. Rollback: KV `flag:SIGNOFF_DESK off`, `flag:BEACON off`; tables and columns stay.

### Phase 2: Sealed Lane and Agent Seats

Order: client fencing quick win; F3 migration; trust at `startRun`; effective trust computation; parent handling and batch carry; `origin_trust` reads; governance hook; Oracle DO trust; F3 observe (staging, then production 14 days); F3 enforce. Then F4 migration; seat resolution; gate and `requested_by` lookup; cost attribution; seats UI; `AGENT_SEATS` observe then enforce; `AGENT_SEAT_CAPS` observe.

F3 staging drill (injection corpus, section 11): `browse_observe` content asks the model to call `save_report` and `browse_goal`. Observe: `sealed_lane_would_block` audits, nothing blocked. Enforce: `save_report` needs a bound single-use Sign-off and a second call with the same approval is refused; `browse_goal` denied; `research_keywords` and `browse_close` run; a follow-up call passing a clean `parentRunId` within 15 minutes is still sealed; a batch with an ingest first seals later messages; a sealed report read by a standard run is fenced and seals the reader; a sealed Oracle session stores no memory facts.

F4 staging drill: seat with `risk_ceiling=read` cannot call `save_report` (`SEAT_BLOCKED`) even with an approval in place; seat A's approval does not satisfy seat B; key without a seat behaves exactly as before (regression suites green); revoked key's next call fails; cost rows carry `seat_id` and `run_id`.

Exit: both drills green; added `callTool` p95 under 25 ms on staging (includes the recency query); F3 observe criteria met before enforce. Rollback: KV `flag:SEALED_LANE off`, `flag:AGENT_SEATS off`, `flag:AGENT_SEAT_CAPS off`; `wrangler rollback <version-id>` for code faults; columns and tables stay.

### Parked (not in scope)

Watches (scheduled user work) and Charters (goals with targets). Revisit after Phase 2 exits; Watches depend on all Phase 1 and 2 controls being live. Skill Ledger and Project Packs remain later ideas.

## 7. Corrections to earlier plans

1. Hazard H2 in `paperclip-pattern-production-ship.md` ("deploy does not migrate") is out of date; `deploy-cloudflare.yml` applies migrations in both envs. The live risk is schema ahead of code, hence expand-only migrations.
2. Hazard H3 ("approval path is SQL-only") is out of date; HTTP approve/deny exists. The live gaps are UI, expiry, rate limits, and approval binding (F1).
3. Production `BUDGET_ENFORCEMENT` is `hard` in `wrangler.jsonc` while `.env.production.example` comments `soft`. Confirm intent (decision 7) and align the example.

## 8. Flag matrix

| Flag | Values | Unset | Phase 1 staging | Phase 1 prod | Phase 2 staging | Phase 2 prod |
|---|---|---|---|---|---|---|
| `SIGNOFF_DESK` | off, on | off | on | on (release 1) | on | on |
| `BEACON` | off, on | off | on | on (release 2, +24 h) | on | on |
| `SEALED_LANE` | off, observe, enforce | off | off | off | observe, then enforce | observe 14 days, then enforce |
| `AGENT_SEATS` | off, observe, enforce | off | off | off | observe, then enforce | observe, then enforce |
| `AGENT_SEAT_CAPS` | off, observe, enforce | off | off | off | observe | observe; enforce after decision 7 |

All flags are off in Phase 0. Each production cell is a separate release under the one-flag rule.

Kill switch: `npx wrangler kv key put flag:<NAME> off --binding LUMINARA_KV --env <env> --remote` (wrangler 4 writes locally without `--remote`). Expected effect within 90 seconds (KV propagation plus 30 s cache). If KV itself is unavailable: set the var to `off` in `wrangler.jsonc` and deploy. After a flag has been stable for 7 days, copy its value into all three vars blocks and delete the KV key, so the vars stay the source of truth.

Code fault: `npx wrangler rollback <version-id> --env <env>`, using the last good Worker version id from `npx wrangler deployments list --env <env>`, recorded in the release ticket next to its git SHA.

Known env drift when reading staging results: staging budget enforcement is `soft` vs production `hard`; high-cost rate limit is 30/60s staging vs 20/60s production.

## 9. SLOs (proposed targets)

- Approve/deny API p95 under 1 second; on-call approval under 60 seconds from Beacon item.
- Beacon emit failure rate under 0.1%; Beacon read p95 under 300 ms.
- Added `callTool` latency (seat plus trust) p95 under 25 ms.
- Seat revocation effective on the next call.
- Flag kill switch effective within 90 seconds.

## 10. Observability, alerting, runbook

- Sentry tags `feature:signoff|beacon|sealed_lane|seats` on reported errors, including from the `scheduled` handler (Phase 0).
- Alerts, computed by the `ops_alerts` 15-minute cron, sent to Sentry (owner: on-call engineer; CEO Telegram for the first two):
  1. pending sign-off older than 15 minutes (half TTL),
  2. any `budget_exhausted` block on a seat,
  3. Beacon emit errors above 0.1% in the last hour,
  4. `sealed_lane_would_block` daily count over 3x its 7-day median (computed from audit rows),
  5. `SEAT_BLOCKED` count over 3x its 7-day median.
- Runbook additions to `docs/ops/MCP-GOVERNANCE.md`: approve, deny, expire, consume; self-approval policy (an owner may approve their own seat's request; bearer-token agents may not approve; agents using the owner's browser session cannot be distinguished, see decision 9); Sealed Lane meaning and override path; flag-off and rollback commands; meaning of each alert.
- Canary: production flag-on first for dogfood accounts via `flag:{NAME}:accounts`, then all accounts. Code canary per Phase 0 item 7.

## 11. Threat model and test plan

| Threat | Control | Test |
|---|---|---|
| Prompt injection from crawled page triggers write or destructive tool | F3 ceiling, client fencing | Injection corpus `tests/fixtures/injection/`: instruction override, fake system tags, tool-call JSON, hidden text, encoded payloads |
| Approval reused for different hostile args | F1 `args_hash` binding, single use for sealed and seated | Same-args succeeds once; different args and second use refused |
| Escape seal with a clean `parentRunId` | Account recency query; parent only tightens | Clean parent within 15 minutes still sealed |
| Escape seal via JSON-RPC batch | In-request trust carry | Ingest then write in one batch |
| Launder sealed content via stored reports or research log | `origin_trust`, fenced reads seal the reader | Sealed report read by standard run |
| Trust lost when provenance write fails | Fallback to tool class plus recency, else sealed | Fault-injected `startRun` |
| Agent approves its own request | `identify` rejects bearer keys and OAuth | `tests/mcpActionRequestsHttp.test.ts` new cases |
| One seat uses another seat's approval | `requested_by` filter | Seat A approval, seat B call refused |
| Approval lifts seat ceiling | Ceiling checked before approval lookup | Read-only seat with approval still blocked |
| Seat attached to another account's key | `INSERT ... SELECT` with account match | Cross-account insert affects zero rows |
| Approving expired request | Route expiry check plus `decide` guard, 410 | Race and expiry tests |
| CSRF on approve or ack | Existing origin check in `identify` for cookie auth | Cross-origin POST rejected |
| Hostile text persisted to memory | Sealed Oracle sessions skip auto-store | `tests/trustLane.test.ts` Oracle case |
| Beacon leaks args to Telegram | Redaction, no `args_json` | Snapshot of push text |
| Beacon row flood | Windowed dedupe, emit only on new requests, retention purge | Dedupe and purge tests |
| Flag silently drops out of enforce on KV outage | Last-good cache, var fallback, never implicit off | `tests/featureFlags.test.ts` |

Coverage: per-file thresholds of 90% lines for `worker/trustLane.ts`, `worker/beacon.ts`, `worker/agentSeats.ts`, `worker/featureFlags.ts`, and the changed parts of `worker/mcpGovernance.ts` (global floors stay). Regression suites every PR: `mcpGovernance`, `budgetPolicies`, `apsMcp`, `browserActionMcp`, `mcpActionRequestsHttp`, `paymentLedger`, `planEntitlements.worker`. All D1 tests use `tests/helpers/sqliteD1.ts`, which applies the real migrations in filename order.

## 12. Release checklist (every release, every environment)

1. [ ] Release SHA green on CI (typecheck, lint, test, coverage, build, tokens, secrets, migration lint).
2. [ ] `wrangler d1 migrations list` on target env; new migrations are expand-only and uniquely numbered.
3. [ ] Flag values set in all three vars blocks; `npm run env:validate` green.
4. [ ] Staging: migrate, preflight, deploy, smoke, phase drill.
5. [ ] Operator approval recorded (GitHub `production` environment reviewer).
6. [ ] Production: migrate, preflight, deploy with new flags off, smoke.
7. [ ] One flag change only: dogfood allowlist first, watch alerts 24 hours, then all accounts.
8. [ ] Last good git SHA, its Worker version id, and kill-switch commands in the release ticket.
9. [ ] Folder README invariants, `docs/ops/` runbook, and provenance doc updated.

## 13. Non-goals

- No local agent runners, Docker, Tailscale, sandbox providers, Discord/GitHub chat adapters, plugin SDK, or OpenTelemetry work.
- No second budget system, no parallel approval table or routes.
- No copying their UI, copy, assets, or schema.
- No change to payment, TON, redemption, or APS pricing semantics.
- No invented SEO or outcome metrics.
- No production deploy without explicit operator approval.

## 14. Decisions

Decided by the CEO (2026-10-03):

1. Scope: Phase 0 to 2 (hygiene, Sign-off Desk, Beacon, Sealed Lane, Agent Seats). Watches and Charters parked.
2. Names: Sign-off Desk, Beacon, Sealed Lane, Agent Seats.
3. Sequence: SMB Launchpad lands first, then Phase 0.

Decided in this plan (engineering; CEO may override):

- F1 extends `/api/mcp-action-requests` instead of adding `/api/signoffs`.
- Sealed and seated approvals are args-bound and single-use.
- Effective trust uses a D1 account-recency query, not KV; a parent can only tighten trust.
- `research_keywords` (capped) and `browse_close` stay allowed while sealed.
- Sealed Oracle sessions skip memory auto-store; in-app trust is advisory.
- Seat ceilings and seat caps are separate flags; only caps wait on decision 7.

Still open:

4. Agent seat limits per tier (`agentSeatLimit` for growth and agency). Needed before F4.
5. Counsel review of section 1 and the provenance doc before investor diligence.
6. Org approvers (`canManageOrg`) for Sign-off Desk: after Phase 2, or never.
7. Was production `BUDGET_ENFORCEMENT=hard` intentional, and was invoice reconciliation signed off? Blocks `AGENT_SEAT_CAPS=enforce`.
8. Standard (unsealed, unseated) destructive approvals: move to args-bound single use now (recommended, closes today's reuse weakness) or keep 30-minute reuse.
9. Step-up confirmation for approvals (re-auth or Telegram confirm) to separate a human from an agent driving the same browser session.

## 15. Stop conditions

Stop and report if: any Paperclip-origin file or asset is found in the tree; a hook point needs a rewrite rather than an extension of `mcpServer.ts`, `budgets.ts`, or `mcpGovernance.ts`; a migration would alter an applied migration or is not expand-only; regression suites fail with all new flags off; or F3 observe shows legitimate flows that cannot be resolved by adjusting the tool list.
