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
- 2026-09-25: Instant Audit provider-failure path now returns not_measured instead of seeded scores. Follow-on: LLM report prose, ROI calculators, and Labs can still invent numbers after metrics are null (honesty)
- 2026-09-26: Anonymous web hosted scout stays closed. Telegram initData and Firebase use FREE_DAILY_LIMIT. A per-scout cap tighter than the request meter is not separate yet (hosted)
- 2026-09-26: Teaser OG image, referral graph, streaks, Idea Scout, and card checkout are deferred (virality)
- 2026-09-26: Crawler-file fetch does not follow redirects. DNS rebinding after the DoH check is a residual (security)
- 2026-09-26: Teaser create quota in KV is read-then-write, not a single atomic increment (share)
- 2026-09-26: Teaser credential scan is pattern-based (bearer, sk-, gsk_, AIza, and similar). A secret shape outside those patterns can still be stored (share)
