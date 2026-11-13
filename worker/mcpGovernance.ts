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
  // Dreaming memory catalogue
  dream_status: { risk: 'read', status: 'active' },
  get_business_memory: { risk: 'read', status: 'active' },
  dream_consolidate: { risk: 'write', status: 'active' },
  review_dream_proposal: { risk: 'write', status: 'active' },
  // Conversion spine & CMS MCP bridge catalogue (0042)
  list_enquiries: { risk: 'read', status: 'active' },
  ingest_enquiry: { risk: 'write', status: 'active' },
  propose_booking_slots: { risk: 'write', status: 'active' },
  decide_booking_signoff: { risk: 'destructive', status: 'active' },
  get_outcomes_funnel: { risk: 'read', status: 'active' },
  classify_cms_remediation: { risk: 'read', status: 'active' },
  prepare_cms_mcp_call: { risk: 'destructive', status: 'active' },
  create_dev_ticket_from_finding: { risk: 'write', status: 'active' },
  compile_review_to_skill: { risk: 'write', status: 'active' },
  mint_habitat_token: { risk: 'write', status: 'active' },
  draft_fix: { risk: 'read', status: 'active' },
  // Named agents (spec 0031): each reads stored rows for one project
  ask_auditor: { risk: 'read', status: 'active' },
  ask_fixer: { risk: 'read', status: 'active' },
  ask_coach: { risk: 'read', status: 'active' },
};

/** What approving does, shown to the owner. Fixed text: never built from a caller's arguments. */
const APPROVAL_CONSEQUENCES: Record<string, string> = {
  browse_goal: "Luminara's hosted browser will carry out a multi-step goal on the site named below.",
  browse_close: 'The hosted browser session named below will be closed.',
  decide_booking_signoff: 'The proposed appointment named below will be approved or declined.',
  prepare_cms_mcp_call: "A change to your website's CMS will be prepared from the details below.",
};

export function approvalConsequence(toolName: string): string {
  return APPROVAL_CONSEQUENCES[toolName] ?? 'The agent will run this action once, with the details below.';
}

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
 * 3. write risk on a credit-spending tool without active subscription -> block
 *    (free-credit writes such as create_project and save_report are open to every plan)
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
  if (gov.risk === 'write' && ctx.creditClass !== 'free' && !ctx.subscriptionActive) {
    return { action: 'block', reason: 'subscription_required' };
  }
  return { action: 'allow' };
}

// ---------------------------------------------------------------------------
// D1-backed action request approval flow
// ---------------------------------------------------------------------------

export type ActionRequestStatus = 'pending' | 'approved' | 'denied' | 'consumed';

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
 * request per (user_id, tool_name, project_id, args); a second create returns the
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
): Promise<{ id: string; existing: boolean; expiresAt: number }> {
  const now = Date.now();
  if (!env.DB) return { id: crypto.randomUUID(), existing: false, expiresAt: now + APPROVAL_TTL_MS };
  const projectId = params.projectId ?? null;
  const argsJson = JSON.stringify(redactSensitive(params.args || {}));

  // An expired pending row can no longer be approved, so it is not reused.
  const existing = await env.DB.prepare(
    `SELECT id, expires_at FROM mcp_action_requests
     WHERE user_id = ? AND tool_name = ? AND status = 'pending' AND kind = 'tool' AND expires_at > ?
       AND (project_id IS ? OR project_id = ?) AND args_json = ?
     ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(params.userId, params.toolName, now, projectId, projectId, argsJson)
    .first<{ id: string; expires_at: number }>();
  if (existing?.id) return { id: existing.id, existing: true, expiresAt: existing.expires_at };

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO mcp_action_requests
     (id, user_id, project_id, tool_name, args_json, status, expires_at, created_at, kind)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 'tool')`,
  )
    .bind(id, params.userId, projectId, params.toolName, argsJson, now + APPROVAL_TTL_MS, now)
    .run();
  return { id, existing: false, expiresAt: now + APPROVAL_TTL_MS };
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

/** One tool request, only for the account that owns it. A missing row and another account's row look the same. */
export async function getOwnedToolRequest(
  env: UserStoreEnv,
  id: string,
  accountId: string,
): Promise<ActionRequestRow | null> {
  if (!env.DB || !id) return null;
  const row = await env.DB.prepare(
    `SELECT * FROM mcp_action_requests WHERE id = ? AND user_id = ? AND kind = 'tool' LIMIT 1`,
  )
    .bind(id, accountId)
    .first();
  return (row as ActionRequestRow | null) ?? null;
}

async function decide(
  env: UserStoreEnv,
  id: string,
  adminId: string,
  status: 'approved' | 'denied',
): Promise<boolean> {
  if (!env.DB) return false;
  const now = Date.now();
  // An expired request can still be denied, never approved.
  const result = await env.DB.prepare(
    `UPDATE mcp_action_requests
     SET status = ?, decided_by = ?, decided_at = ?
     WHERE id = ? AND status = 'pending' AND (? = 'denied' OR expires_at > ?)`,
  )
    .bind(status, adminId, now, id, status, now)
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
 * Consumes one approved, unexpired request for this tool+project whose stored args
 * match `args`. True only when this call flipped it to 'consumed', so an approval
 * authorizes exactly one call with the args the operator saw. Expired approvals never authorize.
 */
export async function consumeApprovedRequest(
  env: UserStoreEnv,
  userId: string,
  toolName: string,
  projectId?: string | null,
  args?: Record<string, unknown>,
): Promise<boolean> {
  if (!env.DB) return false;
  const pid = projectId ?? null;
  const argsJson = JSON.stringify(redactSensitive(args || {}));
  const result = await env.DB.prepare(
    `UPDATE mcp_action_requests SET status = 'consumed'
     WHERE status = 'approved' AND id = (
       SELECT id FROM mcp_action_requests
       WHERE user_id = ? AND tool_name = ? AND status = 'approved' AND kind = 'tool' AND expires_at > ?
         AND (project_id IS ? OR project_id = ?) AND args_json = ?
       ORDER BY created_at LIMIT 1
     )`,
  )
    .bind(userId, toolName, Date.now(), pid, pid, argsJson)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}
