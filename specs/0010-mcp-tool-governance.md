# Spec 0010: MCP Tool Access Governance

Source pattern: paperclip `doc/MCP-ACCESS-GOVERNANCE.md` mental model, scoped down to what Luminara's hosted worker needs. Brand: Luminara only.

## Objective
Layer governance over the existing `worker/mcpServer.ts` tools/call path: risk-classified tool catalog, per-tool policy decision (allow / block / require_approval), a D1-backed action-request approval flow, and a call-event audit entry per decision.

## Requirements
1. `worker/mcpGovernance.ts` exporting:
   - `type ToolRisk = 'read' | 'write' | 'destructive'`
   - `type ToolStatus = 'active' | 'quarantined'`
   - `TOOL_GOVERNANCE: Record<string, { risk: ToolRisk; status: ToolStatus }>` covering every tool name exposed by mcpServer (read the union of PAID_TOOL_CATALOGUE, BROWSER_ACTION_CATALOGUE and any MCP-only tools; default unknown tools to `{ risk: 'write', status: 'active' }` via a helper `governanceFor(toolName)`).
   - `type PolicyDecision = { action: 'allow' } | { action: 'block'; reason: string } | { action: 'require_approval'; reason: string }`
   - `decideToolCall(toolName, ctx: { subscriptionActive: boolean; creditClass: string; identityPlan: string }): PolicyDecision` with deterministic rules:
     - quarantined tool -> block with reason `tool_quarantined`
     - destructive risk -> require_approval unless the caller has an approved, unexpired action request for that tool+project
     - write risk without active subscription -> block `subscription_required` (read this rule; paid tools already gate on subscription so reuse `getActiveSubscription` semantics)
     - otherwise allow
2. Approval flow: D1 migration `migrations/0011_mcp_action_requests.sql` with table `mcp_action_requests(id TEXT PK, user_id TEXT NOT NULL, project_id TEXT, tool_name TEXT NOT NULL, args_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', decided_by TEXT, decided_at INTEGER, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL)` (id = crypto.randomUUID, expires_at default now+30min). Functions `createActionRequest`, `listActionRequests(userId)`, `approveActionRequest(id, adminId)`, `denyActionRequest(id, adminId)`, `hasApprovedRequest(userId, toolName, projectId)` (status='approved' and expires_at > now).
3. Wire into mcpServer: in the tools/call path, before executing a handler, call `decideToolCall`; on `block` return a JSON-RPC error result with the reason; on `require_approval` create an action request if none pending/approved and return content result `{ requiresApproval: true, actionRequestId }` without executing. On `allow`, execute normally. Record every decision via runProvenance/auditLog (payload passed through `redactSensitive` from spec 0009).
4. Operator doc: `docs/ops/MCP-GOVERNANCE.md` documenting the mental model (catalog risk classification, policy decision order, approval flow, audit) adapted from the paperclip doc, in Luminara terms, referencing real file paths and table names. No em dashes.

## Edge cases
- Unknown tool name still executes but is classified write/active and logged.
- Expired approvals never authorize; second call after expiry opens a new request.
- Pending request dedupe: one pending request per (user_id, tool_name, project_id); creating again returns the existing id.
- args_json stored redacted with `redactSensitive`.

## Definition of done
- `npm run typecheck` green.
- New tests `tests/mcpGovernance.test.ts` (>= 20 cases: each decision branch, dedupe, expiry, lifecycle) and integration assertion in existing MCP test path style; `npx vitest run tests/mcpGovernance.test.ts tests/apsMcp.test.ts tests/browserActionMcp.test.ts` green with no regressions in the full `npm run test` suite (report any pre-existing failures separately, do not fix unrelated tests).
- Migration file syntactically valid SQL, consistent with existing migration style (read 0006 for the pattern).

## Iteration budget: 3 build-review loops. Verification commands above plus full `npm run test`.
