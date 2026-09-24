# AI Functions Production Readiness

**Status:** In implementation  
**Source plan:** Cursor plan `ai_functions_production` (do not diverge product rules from APS/e2e)

## Ship gate

Live DataForSEO MCP tools, shared tool registry, unified OpenAI-style tool calling, Agency server Oracle (SSE + Durable Object), queued `/api/audit/run`, staging then production with D1 `0006` (+ later `0007`) migrated.

## Deferred after ship gate

W4 visibility hybrid, W5 PSI/GSC Instant Audit polish, W8 Vectorize / Agent Matrix, MCP OAuth 2.1.

## Phase order

| Phase | Goal |
|-------|------|
| P0 | Deploy APS baseline: migrate `0006`, Settings MCP strip, task pointers |
| P1 | Live paid DFS + registry + 30-day research-log gate |
| P2 | Provider `tools` / `tool_calls` + `runToolLoop` |
| P3 | `OracleSession` DO + `/api/oracle/chat` SSE |
| P4 | Queue + `audit_runs` + Worker-safe v1 consumer |
| P5-P6 | Visibility/PSI/GSC registry feeds; hosted memory |

## Locked decisions

1. One registry: `services/tools/registry.ts`
2. Worker DFS client: `worker/dataForSeoClient.ts` + widened relay allowlist
3. Server-side 30-day research-log reuse before paid spend
4. Minimal `OracleSession` Durable Object
5. Cloudflare Queue `audit-jobs` + D1 `audit_runs`
6. Flags: `ORACLE_SERVER_ENABLED`, `AUDIT_QUEUE_ENABLED` (default off until soak)

See also: [`agent-mcp-product-surface.md`](./agent-mcp-product-surface.md), [`e2e-visibility-agent-platform.md`](./e2e-visibility-agent-platform.md), [`tasks/deploy-gates.md`](../../tasks/deploy-gates.md).
