# MCP Tool Access Governance

Operator reference for the Luminara hosted MCP surface. Describes how tool
calls through `worker/mcpServer.ts` are risk-classified, policy-checked,
approved, and audited.

## Mental model

Every MCP `tools/call` runs through three gates before a handler executes:

1. Catalog classification: each tool name maps to
   `{ risk, status }` in `TOOL_GOVERNANCE` (`worker/mcpGovernance.ts`).
   Risks: `read`, `write`, `destructive`. Statuses: `active`, `quarantined`.
   Unknown tool names default to `{ risk: 'write', status: 'active' }` via
   `governanceFor()` and are still executed and logged.
2. Policy decision: `decideToolCall(toolName, ctx)` is deterministic and
   evaluates in a fixed order.
3. Audit: every decision (allow, block, require_approval) writes one
   `org_audit_logs` row via `recordAuditLogBestEffort` with action
   `mcp_tool_allow`, `mcp_tool_block`, or `mcp_tool_require_approval`.
   The details payload is passed through `redactSensitive`
   (`worker/logRedaction.ts`) before persistence.

## Policy decision order

| Step | Condition | Outcome |
| 1 | tool status is `quarantined` | block, reason `tool_quarantined` |
| 2 | risk is `destructive` and no approved, unexpired request exists for tool+project | require_approval, reason `destructive_requires_approval` |
| 3 | risk is `write` and caller has no active subscription (same `getActiveSubscription` semantics as the paid path in `worker/quotaMiddleware.ts`) | block, reason `subscription_required` |
| 4 | anything else | allow |

## Approval flow

Destructive tools (currently `browse_goal`, `browse_close`) short-circuit
before execution:

- The caller gets a normal content result
  `{ requiresApproval: true, actionRequestId }` with `isError` false. The tool
  handler never ran.
- One row is written to the `mcp_action_requests` table
  (`migrations/0011_mcp_action_requests.sql`):

```
mcp_action_requests(
  id TEXT PRIMARY KEY,        -- crypto.randomUUID()
  user_id TEXT NOT NULL,      -- account id of the MCP caller
  project_id TEXT,            -- args.projectId when present, else NULL
  tool_name TEXT NOT NULL,
  args_json TEXT NOT NULL,    -- redactSensitive'd arguments
  status TEXT DEFAULT 'pending',
  decided_by TEXT, decided_at INTEGER,
  expires_at INTEGER NOT NULL, -- created_at + 30 minutes
  created_at INTEGER NOT NULL
)
```

Lifecycle functions in `worker/mcpGovernance.ts`:

- `createActionRequest` dedupes: one pending request per
  (user_id, tool_name, project_id); re-creating returns the existing id.
- `approveActionRequest(id, adminId)` / `denyActionRequest(id, adminId)`
  transition a pending row; already-decided rows are no-ops.
- `hasApprovedRequest(userId, toolName, projectId)` checks
  `status = 'approved' AND expires_at > now`. Expired approvals never
  authorize; the next destructive call opens a fresh request.

Approving today is preferably via authenticated HTTP (account owner):

```
GET  /api/mcp-action-requests
POST /api/mcp-action-requests/:id/approve
POST /api/mcp-action-requests/:id/deny
```

Auth: same as other protected routes (`identify`). Authz: `user_id` on the row must match `billingId` of the caller. Cross-account approve returns 403. Already-decided rows return 409.

Interim operator SQL (staging drills only):

```sql
UPDATE mcp_action_requests
SET status = 'approved', decided_by = '<admin-id>', decided_at = <ms-epoch>
WHERE id = '<request-id>' AND status = 'pending';
```

## Blocking responses

- `block` returns an error content result with
  `{ code: 'GOVERNANCE_BLOCKED', reason }`.
- `require_approval` returns a success content result with
  `{ requiresApproval: true, actionRequestId }`.

Both still open and close a run in `run_provenance` via
`startRun`/`completeRun` (`worker/runProvenance.ts`), so blocked and gated
calls are reconstructable end to end.

## Quarantining a tool

Set the tool's `status` to `'quarantined'` in `TOOL_GOVERNANCE` and redeploy.
Quarantine wins over every other rule, including existing approvals.

## Where things live

- `worker/mcpGovernance.ts` - catalog, policy, action-request persistence
- `worker/mcpServer.ts` - tools/call wiring (gate before handler dispatch)
- `worker/logRedaction.ts` - `redactSensitive` for args and audit details
- `worker/runProvenance.ts` - per-call run records
- `worker/auditLog.ts` - tamper-evident `org_audit_logs` writes
- `migrations/0011_mcp_action_requests.sql` - `mcp_action_requests` table
- `tests/mcpGovernance.test.ts` - decision branches, lifecycle, expiry, dedupe
