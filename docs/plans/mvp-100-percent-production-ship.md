# MVP 100% Production & Deployment Ship Plan (`mvp-100-percent-production-ship.md`)

**Status:** Active (`feat/aeo-compare-best-hub` -> `main`)  
**Standards:** `ponytail`, `pstack`, `thermo-nuclear-code-quality-review`, `launch-checklist`

## 1. Purpose

This plan closes the engineering, trust-boundary, schema-resilience, funnel-telemetry, and operator-runbook items required to ship Wave `0044` (Unified Agentic Memory, Bi-Temporal Knowledge Graph, and Anamnesis Verifiable Vault) and the Commercial Credibility / PMF funnel cleanly to GitHub (`main`), Cloudflare Staging (`https://staging.luminarasuite.com`), and Cloudflare Production (`https://luminarasuite.com`).

## 2. Locked Invariants

1. **Stripe Checkout Environment Split (`tests/moneyInvariants.test.ts`)**:
   - `wrangler.vars.STRIPE_CHECKOUT_LIVE` stays `"false"` (local dev default).
   - `wrangler.env.staging.vars.STRIPE_CHECKOUT_LIVE` and `wrangler.env.production.vars.STRIPE_CHECKOUT_LIVE` stay `"true"`.
2. **Feature Switches (`tests/featureSwitches.test.ts` Track SW `SW0a-10`)**:
   - `LUMENS_ENABLED` stays `"false"` in all environments (`/api/referrals/checkin` returns `404` when `LUMENS_ENABLED="false"`).
   - Retention runs through the Weekly Decision Loop (`weekly_decisions` + `audit_findings`).
3. **No Em Dashes (`U+2014`)**:
   - Zero em dashes in any new or edited code, comments, tests, or documentation.

## 3. Phases & Tasks

### Phase 1: Wave `0044` Thermo-Nuclear Refactoring, Trust-Boundary Hardening & Schema-Safe Resilience
- [x] **TASK-101 (`worker/oracleChat.ts` & `worker/oracleSession.ts`)**: Remove `'checkpoint'` from client-facing `POST` allowlist in `handleOracleSessionControlRoute` (`worker/oracleChat.ts`); validate `currentNode` against `VALID_GRAPH_NODES` and cap `stateSnapshot` size in `worker/oracleSession.ts`.
- [x] **TASK-102 (`worker/unifiedMemoryRouter.ts`)**: Extract `rowToScopedFact` and `rowToTemporalEdge` helpers (~65 lines removed); wrap D1 queries against `memory_edges` and `0044` `memory_facts` columns in schema-safe `try/catch` blocks with pre-0044 column fallback; use `readBody(request, MAX_SMALL_BODY_BYTES)` in `handleUnifiedMemoryRoute`; reject `accountId`/`userId` body spoofing and enforce `derivation: 'user'` on external client `POST /memory/unified/edges`.
- [x] **TASK-103 (`worker/memoryAutoIngest.ts` & `worker/weeklyDecisionService.ts`)**: Make `findSupersedeCandidateId`, `extractAndStoreChatMemory`, `ingestAuditFindingsToGraph`, `ingestWeeklyDecisionToGraph`, and `ingestDreamProposalToGraph` internally fail-open (`try/catch`); collapse duplicate post-save blocks in `worker/weeklyDecisionService.ts`.
- [x] **TASK-104 (`worker/memoryVaultService.ts`)**: Deduplicate Merkle tree level hashing (`nextMerkleLevel`) and TON memo formatting (`formatTonMemoryMemo`); validate `IPFS_PINNING_URL` (`https:`); wrap D1 vault queries in schema-safe `try/catch`; use `readBody(request, MAX_SMALL_BODY_BYTES)`.
- [x] **TASK-105 (`worker/index.ts`)**: Remove unused imports (`buildSitemapXml`, `upsertAppUser`, `sha256Hex`) and unused catch binding `err` at line 1808.
- [x] **TASK-106 (`tests/agenticMemoryAndVault.test.ts`)**: Replace `as any` with `planCapsFor('growth')`; add regression tests for pre-0044 schema graceful degradation, client `POST /checkpoint` rejection, and `POST /memory/unified/edges` derivation enforcement.

### Phase 2: PMF Telemetry, Checkout Funnel & Honesty Amendments Hardening
- [x] **TASK-201 (`services/analytics/productTelemetry.ts` & `worker/productAnalytics.ts`)**: Persist a durable `guestId` in `localStorage` (`luminara_guest_id`, with `sessionStorage` and in-memory fallback) and use it as `sessionId` in `flushToServer()` so anonymous Probe visits link cleanly to signups, audits, and Stripe checkouts in `product_analytics_events`. Export `ALL_TELEMETRY_EVENT_TYPES` and `ALLOWED_TYPES`.
- [x] **TASK-202 (`components/paywall/PaywallModal.tsx` & `components/paywall/cardCheckout.ts`)**: Fire `checkout_started` in `handleStarsCheckout`, `handleTonCheckout`, and `handleJettonCheckout`, and flush telemetry before `window.location.assign` in `cardCheckout.ts`.
- [x] **TASK-203 (`services/notebook/demoNotebook.ts`, `tests/notebookService.test.ts`, & `services/audit/empiricalCitationService.ts`)**: Scrub orphaned `'3.4 distinct sources'` quote in `demoNotebook.ts:109` and `'73% more citations'` in `notebookService.test.ts`, and remove the `Math.max(25, ...)` score floor in `empiricalCitationService.ts:184` when `queriesCitedCount === 0`.
- [x] **TASK-204 (`tests/productTelemetry.test.ts`)**: Add unit tests verifying parity between `ALL_TELEMETRY_EVENT_TYPES` and `ALLOWED_TYPES`, plus durable `sessionId` persistence across flushes.

### Phase 3: Launch Checklist (`docs/launch-checklist.md`), Smoke-Check Stripe Ledger & Local D1 Migration Verification
- [x] **TASK-301 (`scripts/smoke-check.mjs`)**: Add `'migrations/0021_stripe_payments.sql'`, `'migrations/0024_stripe_payment_intent.sql'`, and `'stripe_credited_sessions'` to D1 preflight arrays, and update the migration range log label.
- [x] **TASK-302 (`docs/launch-checklist.md`)**: Author the step-by-step staging and production deployment guide (`🧑 You`, `🤖 Agent`, `🤝 Together`).
- [x] **TASK-303**: Run `npm run db:migrate:local` and `node scripts/smoke-check.mjs --dry-run`.

### Phase 4: Multi-Subagent + CEO Double-Check Verification Loop
- [x] **TASK-401**: Run and double-check all static, test, and build quality gates (`secrets:check`, `tokens:check`, `env:validate`, `typecheck`, `lint`, `vitest`, `build`, `smoke-check --dry-run`).
- [x] **TASK-402**: Record verified outcomes in `walkthrough.md` and mark all tasks complete.

### Phase 5 (Item 2): Environment, Wrangler, D1 & Stripe Config/Deploy Isolation (`2A` -> `2B` -> `2C`)
- [x] **TASK-501 (Phase 2A - `package.json`, `wrangler.jsonc`, & `scripts/smoke-check.mjs`)**: Add `--env production` to `db:migrate` in `package.json`, clarify `STRIPE_CHECKOUT_LIVE` comments in `wrangler.jsonc`, pass `--env production` in `probeRemoteD1Tables()` when `isProd` is true, and probe `GET /api/memory/unified/timeline` (`401` unsigned) in `scripts/smoke-check.mjs`.
- [x] **TASK-502 (Phase 2B - `scripts/validate-env.mjs`)**: Enforce top-level vs `env.production` binding parity (`d1_databases`, `kv_namespaces`, `r2_buckets`, `queues`, `routes`), `STRIPE_CHECKOUT_LIVE` environment split, staging resource isolation, and explicit `--env` flags on `package.json` deploy/migrate scripts.
- [x] **TASK-503 (Phase 2C - `tests/stagingSafeguards.test.ts`)**: Add regression tests for `package.json` `--env` script isolation and `wrangler.jsonc` top-level vs `env.production` binding parity, then double-check all gates.

### Phase 6 (Item 3): Retention, Fix List, Weekly Decision Loop & Streak/Mission Progression (`3A` -> `3B` -> `3C`)
- [x] **TASK-601 (Phase 3A - `services/referrals/referralClient.ts`, `services/audit/findingBoardService.ts`, `components/retention/ActionableFixList.tsx`, & `components/audit/WeeklyDecisionCard.tsx`)**: Wire `mission_completed` and `fix_shipped` telemetry, move side effects out of `setCompletedFixes` updater in `ActionableFixList.tsx`, persist `writeBag` + `doneOn` in `patchFindingStatus`, and wire `markDone` + `completeWeeklyMission('checklist_fix')` in `WeeklyDecisionCard.tsx`.
- [x] **TASK-602 (Phase 3B - `components/suite/VisibilityRetentionCard.tsx`)**: Surface server-backed weekly streak (`streakWeeks`), completed weekly tasks (`completedCount of totalMissions`), and measured runs (`honestScoutCount`) in plain-language web mode (`!showGame`) while `LUMENS_ENABLED="false"` without Lumens/level theater.
- [x] **TASK-603 (Phase 3C - `tests/retentionLoopItem3.test.ts`)**: Add unit and integration tests for the complete Item 3 retention/fix/streak/mission loop and double-check all quality gates.

### Phase 7 (Item 4): Operator Security, App Check Readiness, Secondary Rail Switches & CC5 Funnel/Cohort Observability (`4A` -> `4B` -> `4C`)
- [x] **TASK-701 (Phase 4A - `worker/appCheck.ts`, `worker/index.ts`, & `docs/launch-checklist.md`)**: Add `describeAppCheckReadiness(env)` and enrich admin-only `GET /api/health` with `appCheckMode`, `appCheckProjectNumberConfigured`, and `stripeConfigured` while leaving public `/api/health` untouched; align `docs/launch-checklist.md` Sections 9-11.
- [x] **TASK-702 (Phase 4B - `worker/productAnalytics.ts`, `worker/stripePayment.ts`, `components/paywall/PaymentReturnNotice.tsx`, `services/analytics/productTelemetry.ts`, & `components/paywall/UsageQuotaBadge.tsx`)**: Wire server and client `payment_completed` and `funnel_abandoned` on Stripe checkout completion/return, `checkPlanLifecycle` (`plan_expiring` / `plan_expired`), and `recordSurveyAnswer` (`survey_answered`).
- [x] **TASK-703 (Phase 4C - `worker/productAnalytics.ts`, `worker/index.ts`, `docs/case-studies/cohort-01.md`, & `tests/item4LaunchReadiness.test.ts`)**: Implement `getProductFunnelSummary` and admin-gated `GET /api/admin/analytics/funnel`, create `docs/case-studies/cohort-01.md` and `tests/item4LaunchReadiness.test.ts`, and double-check all gates.

### Phase 8 (Item 5): Replit Self-Driving Company Agentic Loop (`5A` -> `5B` -> `5C` -> `5D` -> `5E`)
- [x] **TASK-801 (Pillar 2 - `services/deployment/remediationTierRouter.ts`)**: Add `buildVerifiedRemediationPrBundle`, `PreFlightValidationCheck`, and `VerifiedPrHandoffBundle` with deterministic pre-flight validation of `llms.txt` H1/links, `Organization` JSON-LD parseability, zero `U+2014` em dashes, and POSIX-safe shell quoting.
- [x] **TASK-802 (Pillars 1, 3, 4 - `worker/selfDrivingHabitat.ts`, `worker/userTypes.ts`, `worker/apiAccess.ts`, `worker/mcpGovernance.ts`, `worker/mcpServer.ts`, `worker/authMiddleware.ts`, & `worker/index.ts`)**: Implement `compileFeedbackIntoSkillRule` (with auto-resolved `projectId` from `(accountId, domain)`), ephemeral `lm_hab_*` scoped credentials (`mintHabitatToken`, `identifyHabitatToken`) with strict `projectId`/`domain`/`maxRisk` (`'read'` | `'write'`, never `'destructive'`) enforcement on `/mcp`, `buildCoaseanHandoffPacket` (`prepared_assets`), `SELF_DRIVING_MCP_TOOLS` (`create_dev_ticket_from_finding`, `compile_review_to_skill`, `mint_habitat_token`), and auto-compilation on `POST /mcp-action-requests/:id/deny`.
- [x] **TASK-803 (UI - `components/audit/SelfDrivingHabitatBar.tsx` & `components/audit/WeeklyDecisionCard.tsx`)**: Render the 3-tab Self-Driving Agentic Loop bar (Coasean Handoff & PR, Review-to-Skill Compiler with `localStorage` persistence, and Agent Habitat token minting + approval queue) inside the Weekly Decision Loop.
- [x] **TASK-804 (Tests & Smoke Check - `tests/selfDrivingHabitat.test.ts`, `tests/mcpGovernance.test.ts`, & `scripts/smoke-check.mjs`)**: Add comprehensive unit and integration coverage for all 4 pillars plus `/api/agent-habitat/status` (`401` unsigned) in `scripts/smoke-check.mjs`.
- [x] **TASK-805 (Multi-Subagent & CEO Review Loop)**: Complete Full-Stack/Thermo-Nuclear and CEO/Product Auditor subagent reviews, apply all security and brand-stem fixes, and verify all static, test, build, and smoke gates.
