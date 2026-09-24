/**
 * MCP Tool Access Governance (spec 0010).
 *
 * Layers a risk-classified tool catalog, a deterministic per-tool policy
 * decision, and a D1-backed action-request approval flow over the existing
 * worker/mcpServer.ts tools/call path. Every decision is recorded through
 * runProvenance / auditLog with payloads passed through redactSensitive.
 */
import type { UserStoreEnv } from './userStore';
import { redactSensitive } from './logRedaction';

export type ToolRisk = 'read' | 'write' | 'destructive';
export type ToolStatus = 'active' | 'quarantined';

export type ToolGovernanceEntry = { risk: ToolRisk; status: ToolStatus };

/**
 * Risk classification for every tool exposed by mcpServer
 * (built-in MCP tools plus PAID_TOOL_CATALOGUE and BROWSER_ACTION_CATALOGUE).
 */
export const TOOL_GOVERNANCE: Record<string, ToolGovernanceEntry> = {
  // Built-in MCP tools
  whoami: { risk: 'read', status: 'active' },
  list_projects: { risk: 'read', status: 'active' },
  create_project: { risk: 'write', status: 'active' },
  get_project_context: { risk: 'read', status: 'active' },
  update_project_context: { risk: 'write', status: 'active' },
  list_reports: { risk: 'read', status: 'active' },
  get_report: { risk: 'read', status: 'active' },
  save_report: { risk: 'write', status: 'active' },
  // Paid research catalogue
  research_keywords: { risk: 'write', status: 'active' },
  get_domain_overview: { risk: 'read', status: 'active' },
  get_serp_results: { risk: 'read', status: 'active' },
  get_backlinks_overview: { risk: 'read', status: 'active' },
  get_visibility_snapshot: { risk: 'read', status: 'active' },
  get_pagespeed_summary: { risk: 'read', status: 'active' },
  // Browser action catalogue
  browse_observe: { risk: 'read', status: 'active' },
  browse_act: { risk: 'write', status: 'active' },
  browse_goal: { risk: 'destructive', status: 'active' },
  browse_close: { risk: 'destructive', status: 'active' },
};

/** Unknown tools default to write/active and are still logged. */
export function governanceFor(toolName: string): ToolGovernanceEntry {
  return TOOL_GOVERNANCE[toolName] ?? { risk: 'write', status: 'active' };
}

export type PolicyDecision =
  | { action: 'allow' }
  | { action: 'block'; reason: string }
  | { action: 'require_approval'; reason: string };

export type PolicyContext = {
  subscriptionActive: boolean;
  creditClass: string;
  identityPlan: string;
};

/**
 * Deterministic policy, evaluated in order:
 * 1. quarantined tool -> block
 * 2. destructive risk + no approved request -> require_approval
 * 3. write risk without active subscription -> block
 * 4. otherwise allow
 */
export function decideToolCall(
  toolName: string,
  ctx: PolicyContext,
  approved = false,
): PolicyDecision {
  const gov = governanceFor(toolName);
  if (gov.status === 'quarantined') {
    return { action: 'block', reason: 'tool_quarantined' };
  }
  if (gov.risk === 'destructive' && !approved) {
    return { action: 'require_approval', reason: 'destructive_requires_approval' };
  }
  if (gov.risk === 'write' && !ctx.subscriptionActive) {
    return { action: 'block', reason: 'subscription_required' };
  }
  return { action: 'allow' };
}

// ---------------------------------------------------------------------------
// D1-backed action request approval flow
// ---------------------------------------------------------------------------

export type ActionRequestStatus = 'pending' | 'approved' | 'denied';

export type ActionRequestKind = 'tool' | 'budget_override';

export type ActionRequestRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  tool_name: string;
  args_json: string;
  status: ActionRequestStatus;
  kind: ActionRequestKind;
  decided_by: string | null;
  decided_at: number | null;
  expires_at: number;
  created_at: number;
};

const APPROVAL_TTL_MS = 30 * 60 * 1000;

/**
 * Create an action request for a destructive tool call. Dedupe: one pending
 * request per (user_id, tool_name, project_id); a second create returns the
 * existing id.
 */
export async function createActionRequest(
  env: UserStoreEnv,
  params: {
    userId: string;
    toolName: string;
    projectId?: string | null;
    args?: Record<string, unknown>;
  },
): Promise<{ id: string; existing: boolean }> {
  if (!env.DB) return { id: crypto.randomUUID(), existing: false };
  const projectId = params.projectId ?? null;

  const existing = await env.DB.prepare(
    `SELECT id FROM mcp_action_requests
     WHERE user_id = ? AND tool_name = ? AND status = 'pending' AND kind = 'tool'
       AND (project_id IS ? OR project_id = ?)
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(params.userId, params.toolName, projectId, projectId)
    .first<{ id: string }>();
  if (existing?.id) return { id: existing.id, existing: true };

  const id = crypto.randomUUID();
  const now = Date.now();
  const argsJson = JSON.stringify(redactSensitive(params.args || {}));
  await env.DB.prepare(
    `INSERT INTO mcp_action_requests
     (id, user_id, project_id, tool_name, args_json, status, expires_at, created_at, kind)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 'tool')`,
  )
    .bind(id, params.userId, projectId, params.toolName, argsJson, now + APPROVAL_TTL_MS, now)
    .run();
  return { id, existing: false };
}

/** List a user's action requests, newest first. */
export async function listActionRequests(
  env: UserStoreEnv,
  userId: string,
  limit = 50,
): Promise<ActionRequestRow[]> {
  if (!env.DB) return [];
  const result = await env.DB.prepare(
    `SELECT * FROM mcp_action_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(userId, Math.min(Math.max(1, limit), 200))
    .all();
  return (result.results ?? []) as unknown as ActionRequestRow[];
}

async function decide(
  env: UserStoreEnv,
  id: string,
  adminId: string,
  status: 'approved' | 'denied',
): Promise<boolean> {
  if (!env.DB) return false;
  const result = await env.DB.prepare(
    `UPDATE mcp_action_requests
     SET status = ?, decided_by = ?, decided_at = ?
     WHERE id = ? AND status = 'pending'`,
  )
    .bind(status, adminId, Date.now(), id)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export function approveActionRequest(
  env: UserStoreEnv,
  id: string,
  adminId: string,
): Promise<boolean> {
  return decide(env, id, adminId, 'approved');
}

export function denyActionRequest(
  env: UserStoreEnv,
  id: string,
  adminId: string,
): Promise<boolean> {
  return decide(env, id, adminId, 'denied');
}

/**
 * True when the user holds an approved, unexpired request for this
 * tool+project. Expired approvals never authorize.
 */
export async function hasApprovedRequest(
  env: UserStoreEnv,
  userId: string,
  toolName: string,
  projectId?: string | null,
): Promise<boolean> {
  if (!env.DB) return false;
  const pid = projectId ?? null;
  const row = await env.DB.prepare(
    `SELECT id FROM mcp_action_requests
     WHERE user_id = ? AND tool_name = ? AND status = 'approved' AND kind = 'tool' AND expires_at > ?
       AND (project_id IS ? OR project_id = ?)
     LIMIT 1`,
  )
    .bind(userId, toolName, Date.now(), pid, pid)
    .first<{ id: string }>();
  return !!row;
}
