# Papercuts

Append small, non-blocking repository friction here when it happens. Continue the current task.
Do not log secrets, tokens, or PII.

## Format

```
- YYYY-MM-DD: short description (area)
```

## Log

- 2026-10-01: Landing Instant Audit funnel + constellation Map restored; deployed staging+prod from local tree. Branch `feat/mcp-governance-hardening` still has large uncommitted/unpushed delta vs origin. Prod health `xdcRpcOk:false` (XinFin RPC flaky; proof XDC still off) (ops/marketing)
- 2026-09-30: Security remediations landed (fetchPublicUrl, CSRF fail-closed, opaque sessions, 1h TG TTL, prod budget hard, RAG fence). Still open: git history vault purge (ops), crawler compose binds if exposed, DNS TOCTOU, admin beyond shared secret, CSP connect-src * (security)
- 2026-09-30: Virality slice ready locally (Share CTA, MCP telemetry, /methodology, /sample-report, FAQ JSON-LD); needs Worker+assets deploy for live crawl (marketing)
- 2026-09-30: Marketing cinematic stage + sell points + menu shell shipped to staging; hard-refresh staging to see (marketing)

- 2026-09-29: Industry gaps wave: migrations `0014`/`0015`, privacy export/delete APIs, Sentry envelope + analytics ingest, invoice reconcile + hard-stop gate, deploy migrate-before-deploy, D1 DR runbook, mem0 workspace sync + Vectorize/Azure/GCP RAG adapters (ops)
- 2026-09-18: Staging and prod cannot share one Queues consumer; use `luminara-audit-jobs-staging` for staging (wrangler)
- 2026-09-18: Root `tsc` pulls `worker/env` via `services/tools`; import CF binding types from `@cloudflare/workers-types` (worker)
- 2026-09-18: APS plan notes OpenSEO uses Zod; this repo validates at boundaries without adding Zod for MCP v1 (worker)
- 2026-09-19: API key list needs D1 migration `0009_api_key_prefix.sql` on staging+prod before deploy (worker)
- 2026-09-20: Password reset moved to Worker `/api/auth/reset-password`; set `FIREBASE_WEB_API_KEY` in `.dev.vars` for local reset tests (auth)
- 2026-09-20: Firebase/Firestore audit brief maps to Workers+D1; no firestore.rules in this repo (security)
- 2026-09-20: Three-tier rate limits: Workers `ratelimits` bindings + KV dual keys + client useAsyncLock (security)
- 2026-09-19: Staging desktop R2 is `luminara-desktop-releases-staging` (created); keep prod on `luminara-desktop-releases` (wrangler)
- 2026-09-20: PointerBench PNGs are not in git; use `npm run grounding:fetch` into `tmp/pointerbench` (grounding)
- 2026-09-20: Marketing crawl files and path meta need a production deploy before live `/robots.txt` stops returning SPA HTML (seo)

- 2026-09-23: `animate-premium-drift*` is defined in `index.html` (not Tailwind); earlier papercut was a false alarm if you only grep css/config (marketing craft)
- `worker/authMiddleware.ts`: `isPublicRoute()` / `PUBLIC_API_ROUTES` have no callers. `guardApiRoute()` uses `PROTECTED_API_ROUTES` and lets everything else fall through, so the public allow-list is documentation only. Either wire it as a default-deny gate or delete it; a stale "public" list invites false confidence during auth review.
- 2026-09-24: Oracle paid auto-tools need `invokeTool`+`confirmTool` (or `ORACLE_AUTO_TOOLS=true`). App prefers `streamOracleChat` when signed in; guests and Agency-denied soft-fail to BYOK geminiService (oracle)
- 2026-09-25: Hosted Brand Memory dual-write (`services/memory/hostedMemoryStub.ts`) and PointerBench grounding remain eval/lab-only; not on Instant Audit / MCP measurement path (wiring)
- 2026-09-25: Seed `oracle-chat` skill via `scripts/seed-agent-skills.mjs` (or admin `/admin/skills`) so D1 overrides the bundled Oracle system prompt; until then loader uses version-0 fallback (worker)
- 2026-09-25: D1 migration 0010 applied on local + staging + prod (`run_provenance`, `agent_skills`) (deploy)
- 2026-09-25: OpenManus-RL / Nemotron-Agentic / SWE-Lego stay external; in-repo only schema export + evals (`docs/plans/domain-agent-training-mixture.md`) (ml)
- 2026-09-25: App Check still operator: code ready, `REQUIRE_APP_CHECK=false` until console Enforce + site key (auth)
- 2026-09-25: Follow-up from prod gaps review: smoke hard-fail, App Check on reset/OTP, GSC Labs gate, deploy-gates.md, tokens:check in CI (security)
- 2026-09-25: VisibilityRadar no longer invents 68/50; app header deslop toward design.md; craft tracker in tasks/todo.md (craft)
- 2026-09-25: CI runs evals; MCP paid tools require get_project_context; Dashboard step 3 = save project; MessageList deslop (aps)
- 2026-09-27: Share unlock still sends `?password=` from `shareReportClient.ts`; prod rejects query (`SHARE_PASSWORD_QUERY_FORBIDDEN`). Fix in VAL Session 1 via `x-share-password` (share)
- 2026-09-29: Budget `isBudgetHalted` used to fail-closed on missing tables (paid MCP outage if Worker shipped before D1 migrate). H1 now schema-aware fail-open; new policies default hard_stop off; `BUDGET_ENFORCEMENT` kill-switch (budget)
- 2026-09-29: Staging Worker `dfe56b38` deployed with `REQUIRE_TG_AUTH=true`; `smoke:staging` green (findings 401). Prod Worker `eea83918` + D1 `0011`-`0013`; `smoke:prod` green (deploy)
- 2026-09-29: `smoke-check` remote D1 probe needs one shell cmdline + `JSON.stringify(sql)` on Windows; argv `--command` split breaks wrangler (scripts)
- 2026-09-25: Instant Audit provider-failure path now returns not_measured instead of seeded scores. Follow-on: LLM report prose, ROI calculators, and Labs can still invent numbers after metrics are null (honesty)
- 2026-09-26: Anonymous web hosted scout stays closed. Telegram initData and Firebase use FREE_DAILY_LIMIT. A per-scout cap tighter than the request meter is not separate yet (hosted)
- 2026-09-26: Teaser OG image, referral graph, streaks, Idea Scout, and card checkout are deferred (virality)
- 2026-09-26: Crawler-file fetch does not follow redirects. DNS rebinding after the DoH check is a residual (security)
- 2026-09-26: Teaser create quota in KV is read-then-write, not a single atomic increment, so concurrent creates can exceed 5/account/day (share)
- 2026-09-26: Teaser credential scan is pattern-based (bearer, sk-, gsk_, AIza, and similar). A secret shape outside those patterns can still be stored (share)
- 2026-09-28: `.githooks/pre-commit` is not executable, so git skips it (`hint: hook was ignored`) (git)
- 2026-09-29: Niche Pulse cron is not wired; `/pulse` is opt-in only (idea scout)

- 2026-10-03: `tests/` is excluded from every tsconfig, so test fixtures can use wrong types silently (a launchpad test passed a HostedIdentity with nonexistent fields). Consider a `tsconfig.tests.json` in `npm run typecheck`.
- 2026-10-03: `@nomicfoundation/hardhat-toolbox@5` peers (typescript, ts-node, chai@4, typechain, solidity-coverage, etc.) are not auto-installed on npm 11; `hardhat compile` crashed in ts-node until they were listed explicitly in `contracts/package.json` (contracts)
- 2026-10-07: `BusinessDNA` has no domain field, so the Trust view prefills from the Instant Audit URL draft instead of the active project (trust)
- 2026-10-07: Worker gives no way to re-read DNS/file/meta instructions for a pending domain after the start response; the UI offers "New token" (re-issues) instead (trust)

- 2026-10-07: Local `.env` VITE_* provider keys leak into vitest via import.meta.env and fail 14 tests (unifiedScraper, localSidecarGate, etc.). CI is clean. Tests should stub import.meta.env or vitest should not load .env. Also hostedProviderReady 'awaits...' test flakes under full-suite load, passes alone.
