# Go-Live: Close Open AI Functions Items

**Date:** 2026-09-18  
**Status:** Complete (G0-G4 shipped; staging+prod live)  
**Operator approval:** Explicit user request to complete remaining open items (prod migrate/deploy included).

## Goal

Close every item previously marked "still open by design" so AI functions (MCP paid tools, Oracle SSE, queued audit, W4 visibility, W5 PSI/GSC, W8 memory, MCP OAuth) are production-ready and deployed.

## What was still open

| Item | Close with |
|------|------------|
| Production D1 `0006`/`0007` | `npm run db:migrate` |
| Staging + production deploy | `wrangler deploy` (+ staging) |
| Flags off | Set `ORACLE_SERVER_ENABLED` / `AUDIT_QUEUE_ENABLED` to `true` |
| W4 stub only | Live DFS Mentions + OpenRouter probes + router |
| W5 stub only | PSI service + Instant Audit panels + GSC CSV |
| W8 stub only | Hosted memory API (D1) + Agent Matrix OpenRouter Claude |
| MCP OAuth deferred | Minimal OAuth 2.1 + PKCE; API keys remain |

## Locked decisions

1. **W4:** DFS Mentions first for chatgpt/google_aio; OpenRouter answer probes for gaps/Perplexity-class; else `not_measured`.
2. **W5:** PSI via Google API (BYOK or hosted `PAGESPEED_API_KEY`); GSC CSV in Instant Audit; GSC OAuth returns `not_configured` until secrets exist.
3. **W8:** D1 `memory_facts` + `/api/memory/facts` before Vectorize; Agent Matrix `claude` → OpenRouter Anthropic.
4. **OAuth:** Authorization Code + PKCE; scopes `mcp:free` / `mcp:research`; keep `lm_live_*` keys.
5. **Flags on** in wrangler vars after migrate.

## Architecture (ship shape)

```
MCP / Oracle / Audit Queue
        │
        ▼
 shared tools registry (services/tools/*)
        │
   ┌────┴────┬──────────┬──────────┐
   ▼         ▼          ▼          ▼
 DataForSEO  Visibility  PageSpeed  Memory
 (paid)      router      Insights   D1 facts
             (DFS+LLM)
```

Auth stack for MCP: session cookie → `lm_live_*` API key → `mcp_*` OAuth token (`resolveMcpUser`).

## Phases (execute in order)

### G0 - Migrate, flags, deploy

1. Apply D1 migrations `0005`-`0008` staging then prod.
2. Confirm `ORACLE_SERVER_ENABLED=true` and `AUDIT_QUEUE_ENABLED=true` in top-level + env vars.
3. Deploy staging, smoke `/api/health`, `/api/mcp` auth gate, Oracle/audit flags.
4. Deploy production, smoke same.

**Exit:** Staging and prod Workers live; migrations applied; flags on.

### G1 - Live W4 visibility

1. `engineVisibilityRouter` + DFS Mentions + OpenRouter LLM probes.
2. `get_visibility_snapshot` in paid registry uses router; never invents rates.
3. Wire `llmGenerate` from `OPENROUTER_API_KEY` in `buildPaidToolRuntime`.
4. Tests: stubs remain honest; router prefers measured DFS over probes.

**Exit:** MCP/Oracle can return `measured` or explicit `not_measured`.

### G2 - Live W5 PSI / GSC

1. `pageSpeedService` live call; Instant Audit `PageSpeedPanel` + `GscPanel`.
2. GSC CSV parse; `allowSimulate` Labs-only.
3. Paid tool `get_pagespeed_summary` uses hosted/BYOK key.

**Exit:** Instant Audit shows PSI/GSC panels; MCP PSI tool returns metrics or `not_measured`.

### G3 - W8 memory + Agent Matrix

1. Migration `0008_memory_facts.sql`.
2. `GET/POST /api/memory/facts` (auth required).
3. Client dual-write via `hostedMemoryStub`.
4. Agent Matrix `claude` / `openrouter` / `codex` via OpenRouter (no fake success text unless `luminara_demo_agents=1`).

**Exit:** Facts persist in D1; Claude path refuses to invent output without keys.

### G4 - MCP OAuth 2.1 + PKCE

1. `GET /api/oauth/mcp/authorize` (session required).
2. `POST /api/oauth/mcp/token` (public; PKCE S256).
3. Discovery metadata endpoint.
4. `identifyMcpOAuthToken` in `resolveMcpUser`; API keys remain primary.

**Exit:** MCP clients can use `mcp_*` bearer tokens; `lm_live_*` still works.

## Production checklist

- [x] D1 remote migrate staging + prod through `0008`
- [x] Deploy staging + smoke
- [x] Deploy production + smoke
- [ ] Optional secrets: `PAGESPEED_API_KEY`, `MCP_OAUTH_SECRET` (operator)
- [ ] App Check: set `VITE_FIREBASE_APPCHECK_SITE_KEY`, enforce Authentication in Firebase console, then optionally `REQUIRE_APP_CHECK=true` (see `docs/ops/beginner-azure-and-app-check.md`)
- [x] Observability: Worker observability enabled in wrangler
- [x] Never invent SEO metrics (`not_measured` / `unknown`)
- [x] Pricing/Paywall entitlement truth (Growth = MCP + share; no fake free-trial CTA)

## Out of scope (next wave)

- Vectorize semantic memory
- Full GSC OAuth (needs Google client secrets)
- Multi-provider OAuth clients UI in Settings
- Hosted OpenRouter/DataForSEO secrets on staging (currently BYOK-oriented)

Companion: [`ai-functions-production.md`](./ai-functions-production.md), [`tasks/deploy-gates.md`](../../tasks/deploy-gates.md).
