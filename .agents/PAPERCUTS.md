# Papercuts

Append small, non-blocking repository friction here when it happens. Continue the current task.
Do not log secrets, tokens, or PII.

## Format

```
- YYYY-MM-DD: short description (area)
```

## Log

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
- 2026-09-29: Staging `REQUIRE_TG_AUTH` set true in wrangler.jsonc; live `/api/health` still false until `npm run deploy:staging` (deploy)
- 2026-09-29: `smoke-check` remote D1 probe needs one shell cmdline + `JSON.stringify(sql)` on Windows; argv `--command` split breaks wrangler (scripts)
