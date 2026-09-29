# Paperclip-pattern production ship plan (specs 0009-0014)

Status: **implementation plan (H1 landed in tree; execute remaining phases)**  
Audience: CEO / staff eng / deploy operator  
Source clone (pattern library only): sibling checkout of `paperclipai/paperclip` @ `53aad90b9` (outside this repo; never vendored)  
Brand: Luminara only. Never fork paperclip product names, packages, or UI into this repo.

Assumption: "Complete an implementation plan for the above" means ship and harden the paperclip-sourced Luminara specs (`0009`-`0014`) to production and deployment readiness, not greenfield reimplementation. Code for `0009`-`0012` and much of `0014` already exists in tree; this plan is the **ship / harden / migrate / roll out** sequence with double-check gates.

**H1 progress (2026-09-29):** schema-aware fail-open, soft-alert default on upsert, and `BUDGET_ENFORCEMENT` kill-switch are in `worker/budgets.ts` (+ tests green). Remaining: Phase C migrate drill, smoke preflight, lock 0013 open questions, Budget-P0 soft alerts.

**10x successor:** [`suite-10x-production-ship.md`](./suite-10x-production-ship.md) expands this plan into Track P (platform) parallel with Track V (Blender HD plates + Canvas; Three gated). Prefer that doc for craft/platform execute order. **Investor-critical activation spine:** [`investor-marketable-10x-ship.md`](./investor-marketable-10x-ship.md).

## 1. Requirements checklist (from the ask)

1. Clone / refresh `paperclipai/paperclip` as a read-only pattern library.
2. Produce a complete, production- and deployment-ready implementation plan.
3. Use specialist engineering review (explore + CEO + deploy hazard).
4. Double-check for misses and 10x improvements before adding anything new.
5. Keep Luminara brand, APS invariants, and no em dashes.

## 2. Spec status matrix (verified 2026-09-29)

| Spec | Intent | Code status | Prod-ready? |
|---|---|---|---|
| 0009 Log redaction | `worker/logRedaction.ts` + audit/sentinel wire | **DONE** (tests `tests/logRedaction.test.ts`) | Yes after staging audit sample |
| 0010 MCP governance | `worker/mcpGovernance.ts` + `migrations/0011_*` | **DONE** (tests `tests/mcpGovernance.test.ts`, ops `docs/ops/MCP-GOVERNANCE.md`) | Only after D1 `0011` applied |
| 0011 Forbidden tokens | `scripts/check-forbidden-tokens.mjs` + hooks + CI | **DONE** | Yes (repo/CI only) |
| 0012 License vault verify | seed/verify/manifest + optional KV fields | **DONE** | Yes at next rotation |
| 0013 Budget design | `docs/plans/budget-policies-and-enforcement.md` | **DONE** (docs) | Lock open questions before hard-stop flip |
| 0014 Budget enforcement | `worker/budgets.ts` + migrations `0012`/`0013` | **CODE LANDED** (beyond 0013 docs-only) | **NOT prod-safe until hazards below fixed** |

Paperclip sources used as patterns only:

- `server/src/log-redaction.ts`
- `doc/MCP-ACCESS-GOVERNANCE.md`
- `scripts/check-forbidden-tokens.mjs`
- `server/src/secrets/` (fingerprint / health ideas)
- `doc/plans/2026-03-14-budget-policies-and-enforcement.md` + `server/src/services/budgets.ts`

## 3. Critical production hazards (must fix before budget-aware Worker ships)

### H1. Fail-closed budget halt without schema = paid MCP outage

**Status: LANDED (2026-09-29).** `isBudgetHalted` fails open on missing schema; upsert defaults `hard_stop_enabled=0`; `BUDGET_ENFORCEMENT` kill-switch in `worker/env.ts` + wrangler vars (`soft`). See suite-10x Track P.

Historical hazard (kept for operators): before H1, missing tables halted all paid MCP.

### H2. Migrate vs deploy race

- `.github/workflows/deploy-cloudflare.yml` deploys Worker + smoke; it does **not** apply D1 migrations.
- Operator must run `npm run db:migrate:staging` / `npm run db:migrate` **before** deploying code that requires new tables.
- Add a preflight smoke or deploy gate: `SELECT` against `mcp_action_requests` / `budget_policies` and fail the release if required tables are missing for the build being shipped.

### H3. Approval path is SQL-only

- Destructive MCP tools create `mcp_action_requests` with 30-minute TTL.
- Ops doc documents raw SQL approve/deny; no authenticated admin UI/API yet.
- Production destructive MCP will stall unless on-call can approve quickly.

### H4. Catalog and column drift

- Unknown tools default `write`/`active` and still execute; new tools must enter `TOOL_GOVERNANCE`.
- Budget override queries need `migrations/0013_mcp_action_requests_kind.sql` (`kind` column). Do not deploy SQL that requires `kind` until that migration is applied.

## 4. Non-goals

- Do not copy paperclip brand, `@paperclipai/*`, Application/Connection/Profile/Gateway vocabulary, or their Budget UI card names.
- Do not invent SEO metrics; missing data stays `not_measured` / `unknown`.
- Do not rewrite `quotaMiddleware` into a money budget (design rejected).
- Do not change payment/TON/redemption semantics.
- Do not auto-deploy production without explicit operator approval (APS).
- Do not nest the paperclip clone inside this workspace.

## 5. Phased delivery (each phase: staging then prod)

### Phase A: Repo/CI identity (0011) - ship anytime

**Work:** Confirm hooks + CI already green; document token-list hygiene.

**Exit criteria:**

- `npm run tokens:check` and `npm run secrets:check` exit 0
- Fresh clone with `npm ci` installs hooks via `prepare`
- No runtime deploy required

**Rollback:** revert PR; no Worker impact.

### Phase B: Log redaction (0009) - ship anytime

**Work:** Confirm wire-in; expand remaining hot `console` / provider-relay error paths to `safeLog` only if a gap appears in staging samples (do not drive-by rewrite every log).

**Exit criteria:**

- Staging audit row with seeded secret shows `[redacted]`
- `npx vitest run tests/logRedaction.test.ts` green
- Prod deploy after staging sample

**Rollback:** prior Worker SHA (keeping redaction is safer than removing it).

### Phase C: MCP governance (0010) - migrate then deploy

**Order of operations (hard):**

1. `npm run db:migrate:staging` (apply `0011_mcp_action_requests.sql`)
2. Confirm table exists on `luminara-users-staging`
3. `npm run deploy:staging` + `npm run smoke:staging`
4. Drill: destructive tool returns `requiresApproval` + `actionRequestId`; SQL approve; second call executes within TTL
5. Prod: `npm run db:migrate` then deploy + `npm run smoke:prod`

**Exit criteria:**

- Write without subscription blocked (`subscription_required`)
- Destructive require_approval path works end-to-end
- Audit actions `mcp_tool_allow|block|require_approval` with redacted details
- APS: Free MCP Growth+; paid needs Agency `apiAccess` or BYOK; `get_project_context` before paid research

**Rollback:** redeploy prior Worker; leave table in place (additive). Do not DROP.

### Phase D: License vault verification (0012) - at next rotation

**Order:** staging KV first (`wrangler.jsonc` env ids), then prod KV.

**Exit criteria:**

- Seed `--apply` stamps `vaultGeneration` + `keySha256`
- Manifest under `.secrets/` (gitignored)
- `node scripts/verify-license-vault.mjs` → `verified N/N`
- Legacy keys counted as informational, not false failures
- Redemption semantics unchanged

**Rollback:** re-seed previous generation from offline vault backup; keep prior manifest offline.

### Phase E: Budget harden + design lock (0013/0014) - blocking

**E0. Lock design open questions** (write decisions into the design record):

| Question | Recommended decision for P0/P1 |
|---|---|
| Budget approval TTL | Per-`kind`: tool 30m; `budget_override` 72h or until UTC window end |
| Who may raise budgets | Account owner + org admins (RBAC from `0003`); document until UI exists |
| DFS cost attribution | Prefer provider-returned `cost` when present; else interim credit-class cents marked `source` |
| BYOK | Zero-cents `cost_events` for visibility only in P0/P1 |
| Free daily quota toward budget | Out of scope until later metric class |
| Resume-once lifetime | P2 only; for monthly: resume-once for current UTC window |
| Soft-alert channel | Audit + `GET /api/budgets/self` in P0; Telegram optional follow-on |

**E1. Code harden (must land before migrate+deploy of budget Worker):**

1. Schema-aware fail-open in `isBudgetHalted` when tables/columns missing.
2. Do not force `hard_stop_enabled = 1` on upsert during soft-alert era; default `0`.
3. Env kill-switch `BUDGET_ENFORCEMENT` (`off` skip gate, `soft` alerts only, `hard` enforce).
4. Preflight: migration presence check in smoke or deploy docs checklist.
5. Tests proving: missing table → not halted; policy with hard stop off → not halted; policy over spend → halted.

**E2. Budget-P0 soft alerts (staging then prod):**

1. Apply `0012_budget_policies.sql` + `0013_mcp_action_requests_kind.sql` on staging D1
2. Deploy Worker with kill-switch `soft` or hard-stop default off
3. Create optional policies for dogfood accounts only (no auto-policy for all accounts)
4. Reconcile `cost_events` vs DataForSEO / OpenRouter invoices for one billing window
5. Repeat for prod only after invoice delta is acceptable

**E3. Budget-P1 hard stops:**

1. Flip kill-switch to `hard` or set `hard_stop_enabled = 1` per policy intentionally
2. Confirm `BUDGET_EXHAUSTED` audit + resume via `budget_override`
3. Keep quotas and budgets mentally separate for on-call

**E4. Budget-P2 (later):** project lifetime budgets + UI cards (Luminara names only).

**Rollback (budget):**

- Soft: `UPDATE budget_policies SET hard_stop_enabled = 0, is_active = 0` and/or env `BUDGET_ENFORCEMENT=off`
- Hard: redeploy known-good Worker SHA
- Do not DROP `cost_events` (evidence)

## 6. Quality gates (every PR / every release SHA)

```bash
npm run secrets:check
npm run tokens:check
npm run env:validate
npm run typecheck
npm run lint
npm test
npm run test:coverage
npm run build
```

Phase slices:

- A: `tests/forbiddenTokens.test.ts`
- B: `tests/logRedaction.test.ts`
- C: `tests/mcpGovernance.test.ts tests/apsMcp.test.ts tests/browserActionMcp.test.ts`
- D: `tests/licenseVaultVerify.test.ts tests/licenseKey.test.ts`
- E: `tests/budgetPolicies.test.ts` (+ MCP suite above)

Post-deploy: `npm run smoke:staging` / `npm run smoke:prod`.

## 7. Operator checklist (production flip)

### Always

- [ ] Explicit deploy approval
- [ ] Green CI on release SHA; staging smoke green first
- [ ] Correct D1 (`luminara-users` vs staging) and KV binding for env
- [ ] `validate-env` for target env
- [ ] No `.secrets/` manifests or vault JSON in git status

### Before Phase C (governance)

- [ ] Migration `0011` applied (`wrangler d1 migrations list` or equivalent)
- [ ] On-call knows SQL approve path and 30m TTL
- [ ] No accidental quarantine left from staging drills

### Before Phase D (vault)

- [ ] Offline backup of vault + last good manifest
- [ ] Staging KV verify exit 0 before prod seed

### Before Phase E (budget)

- [ ] Design open questions locked in writing
- [ ] Schema-aware fail-open + kill-switch in the build
- [ ] Migrations `0012` + `0013` applied **before** Worker that requires them
- [ ] All policies `hard_stop_enabled = 0` for soft-alert window
- [ ] No default budgets auto-created for all accounts
- [ ] Invoice reconciliation plan agreed
- [ ] Rollback SQL + prior Worker SHA noted in the change ticket

## 8. Double-check log (what was missed / 10x)

### Usually missed (caught by specialists)

1. Deploy workflow does not migrate D1.
2. Fail-closed on missing budget tables outages paid MCP even for unbudgeted accounts.
3. `kind` column migration must ship with budget override queries.
4. Staging vs prod KV ids differ for vault seed.
5. Approval TTL too short for human operators on destructive tools.
6. Unknown MCP tools still execute as write/active.
7. Hooks skipped when `npm ci --ignore-scripts`.
8. Budget code already in tree: "governance-only" deploy is unsafe without H1 fix.
9. Upsert forcing hard stops on by default.
10. Soft alerts without a human-visible channel look "done" but are audit-only.

### 10x improvements (prioritized)

1. Schema-aware fail-open + env kill-switch (unblocks safe deploys).
2. Migrate preflight in smoke/deploy (blocks silent schema drift).
3. Authenticated approve/deny API + minimal operator UI for `mcp_action_requests`.
4. Cost attribution golden set vs invoices before any hard stop.
5. Add governance require_approval drill to `scripts/smoke-check.mjs`.
6. Expand redaction to remaining provider-relay error paths with `secretValues`.
7. Soft-alert delivery (Telegram or dashboard strip) so incidents are not log-only.
8. Single decision vocabulary forever: quarantine, subscription, budget_exhausted share one audit grammar.

### Double-check of the double-check (before adding anything new)

Before proposing new files or features beyond this plan:

1. Prefer edit of `worker/budgets.ts`, `worker/mcpServer.ts`, smoke scripts, and ops docs over new packages.
2. Do not add a second budget system or parallel approval table.
3. Do not import paperclip packages.
4. Do not create a wrapper folder for paperclip inside Luminara.
5. Any new migration number must be verified against `migrations/` at implement time.
6. Any new env binding must be added to env validation examples without committing secrets.

## 9. Recommended execute order (next engineering loops)

1. **Loop 1 (blocking):** implement H1 schema-aware fail-open + hard-stop default off + optional `BUDGET_ENFORCEMENT` kill-switch; tests; typecheck.
2. **Loop 2:** Phase C migrate+deploy staging (governance `0011`) if not already applied; smoke drill.
3. **Loop 3:** smoke preflight for required D1 tables; document in `docs/ops/MCP-GOVERNANCE.md` and budget plan.
4. **Loop 4:** lock 0013 open questions in the design record; then Budget-P0 soft alerts on staging dogfood only.
5. **Loop 5:** operator approval API (minimal) for action requests.
6. **Later:** Budget-P1 hard stops after invoice reconciliation; Phase D at next license rotation; Budget-P2 project budgets.

## 10. File index

| Concern | Paths |
|---|---|
| Redaction | `worker/logRedaction.ts`, `worker/auditLog.ts`, `worker/sentinel.ts` |
| Governance | `worker/mcpGovernance.ts`, `worker/mcpServer.ts`, `migrations/0011_mcp_action_requests.sql`, `docs/ops/MCP-GOVERNANCE.md` |
| Tokens | `scripts/check-forbidden-tokens.mjs`, `.githooks/forbidden-tokens.txt`, `.githooks/pre-commit` |
| License vault | `worker/licenseService.ts`, `scripts/seed-license-vault.mjs`, `scripts/verify-license-vault.mjs`, `docs/plans/license-rotation-runbook.md` |
| Budget design | `specs/0013-budget-model-design.md`, `docs/plans/budget-policies-and-enforcement.md` |
| Budget code | `specs/0014-budget-enforcement.md`, `worker/budgets.ts`, `migrations/0012_budget_policies.sql`, `migrations/0013_mcp_action_requests_kind.sql`, `tests/budgetPolicies.test.ts` |
| Deploy | `wrangler.jsonc`, `package.json` scripts, `.github/workflows/ci.yml`, `.github/workflows/deploy-cloudflare.yml` |
| Pattern library | Sibling `paperclipai/paperclip` checkout (outside this repo) |

## 11. Stop conditions

Stop claiming "production ready" for budget enforcement until:

- H1 fail-open is merged and tested
- Staging migrations `0012`+`0013` applied and smoke proves paid MCP still works with no policies
- Soft-alert window reconciled against invoices
- Operator explicitly approves hard-stop enablement

Stop the engineering loop when Phase E0+E1 are merged and Phase C staging drill is green, unless the operator asks to continue into Budget-P0.
