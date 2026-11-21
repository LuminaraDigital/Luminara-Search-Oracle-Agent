/**
 * Approval-card state machine, as pure functions over the session object's record
 * (worker/oracleSession.ts keeps only routing and storage). Kept apart from the old
 * PendingToolGate on purpose: no remember cascade, no allow-list, single use, expiry enforced.
 * The shape follows Track SW's approval rules (args hash, requester, expiry, single use) so it can
 * move into SW2's store later.
 *
 * Transitions: pending -> executing (approve) -> approved_done | failed
 *              pending -> denied (reject)
 *              pending -> expired (past expiresAt)
 *              executing -> failed_unknown (past AGENT_ACTION_EXECUTING_MS; never retried)
 */

export type AgentActionStatus = 'pending' | 'executing' | 'approved_done' | 'denied' | 'expired' | 'failed' | 'failed_unknown';

export interface AgentActionGate {
  actionId: string;
  toolName: string;
  args: Record<string, unknown>;
  argsHash: string;
  projectId: string | null;
  requesterId: string;
  preview: string;
  costNote: string;
  tainted: boolean;
  turnId: string;
  status: AgentActionStatus;
  summary: string | null;
  createdAt: number;
  expiresAt: number;
  executingAt?: number;
  resolvedAt?: number;
}

/** The fields of a gate a client may see (no args, no requester). */
export type AgentActionView = Pick<
  AgentActionGate,
  'actionId' | 'toolName' | 'preview' | 'costNote' | 'tainted' | 'status' | 'summary' | 'createdAt' | 'expiresAt'
>;

export type AgentActions = Record<string, AgentActionGate>;

/** Store result: the HTTP answer, and whether the record must be written back. */
export type StoreResult = { status: number; body: Record<string, unknown>; changed: boolean };

export const AGENT_ACTION_TTL_MS = 30 * 60 * 1000;
/** An approved action still "executing" after this long is reported as an unknown outcome. */
export const AGENT_ACTION_EXECUTING_MS = 2 * 60 * 1000;
export const MAX_AGENT_ACTIONS = 30;
export const MAX_ACTION_ARGS_CHARS = 2048;
const MAX_TOOL_NAME_LEN = 64;
const ACTION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UNKNOWN_OUTCOME = 'We could not confirm this ran. Check before trying again.';

export function agentActionView(gate: AgentActionGate): AgentActionView {
  return {
    actionId: gate.actionId,
    toolName: gate.toolName,
    preview: gate.preview,
    costNote: gate.costNote,
    tainted: gate.tainted,
    status: gate.status,
    summary: gate.summary,
    createdAt: gate.createdAt,
    expiresAt: gate.expiresAt,
  };
}

function lookup(actions: AgentActions, actionId: string): AgentActionGate | undefined {
  return ACTION_ID_RE.test(actionId) && Object.hasOwn(actions, actionId) ? actions[actionId] : undefined;
}

/** Expire pending cards, time out executing ones, and keep the newest MAX_AGENT_ACTIONS. Mutates. */
export function refreshActions(actions: AgentActions, now: number): { actions: AgentActions; changed: boolean } {
  let changed = false;
  for (const gate of Object.values(actions)) {
    if (gate.status === 'pending' && now >= gate.expiresAt) {
      gate.status = 'expired';
      gate.resolvedAt = now;
      changed = true;
    } else if (gate.status === 'executing' && now - (gate.executingAt ?? now) >= AGENT_ACTION_EXECUTING_MS) {
      gate.status = 'failed_unknown';
      gate.summary = UNKNOWN_OUTCOME;
      gate.resolvedAt = now;
      changed = true;
    }
  }
  const entries = Object.entries(actions);
  if (entries.length <= MAX_AGENT_ACTIONS) return { actions, changed };
  const live = (g: AgentActionGate) => (g.status === 'pending' || g.status === 'executing' ? 1 : 0);
  const kept = entries.sort((a, b) => live(b[1]) - live(a[1]) || b[1].createdAt - a[1].createdAt).slice(0, MAX_AGENT_ACTIONS);
  return { actions: Object.fromEntries(kept), changed: true };
}

/** Newest first, at most ten, without args or requester. */
export function listViews(actions: AgentActions): AgentActionView[] {
  return Object.values(actions)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 10)
    .map(agentActionView);
}

export function parkGate(
  actions: AgentActions,
  body: Partial<AgentActionGate> & { ttlMs?: number },
  now: number,
  activeTurnId: string | null,
  isForbiddenTool: (name: string) => boolean,
): StoreResult {
  const actionId = String(body.actionId || '');
  const toolName = String(body.toolName || '').trim();
  const requesterId = String(body.requesterId || '');
  if (!ACTION_ID_RE.test(actionId) || !toolName || toolName.length > MAX_TOOL_NAME_LEN || isForbiddenTool(toolName) || !requesterId) {
    return { status: 400, body: { ok: false, error: 'actionId, toolName and requesterId required', code: 'BAD_REQUEST' }, changed: false };
  }
  if (lookup(actions, actionId)) {
    return { status: 409, body: { ok: false, error: 'action already exists', code: 'DUPLICATE' }, changed: false };
  }
  const args = body.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {};
  if (JSON.stringify(args).length > MAX_ACTION_ARGS_CHARS) {
    return { status: 413, body: { ok: false, error: 'action arguments too large', code: 'TOO_LARGE' }, changed: false };
  }
  const ttl = Math.min(Math.max(Number(body.ttlMs) || AGENT_ACTION_TTL_MS, 60 * 1000), 60 * 60 * 1000);
  actions[actionId] = {
    actionId,
    toolName,
    args,
    argsHash: String(body.argsHash || '').slice(0, 128),
    projectId: typeof body.projectId === 'string' ? body.projectId.slice(0, 128) : null,
    requesterId: requesterId.slice(0, 256),
    preview: String(body.preview || '').slice(0, 1500),
    costNote: String(body.costNote || '').slice(0, 400),
    tainted: body.tainted !== false,
    turnId: String(body.turnId || activeTurnId || '').slice(0, 64),
    status: 'pending',
    summary: null,
    createdAt: now,
    expiresAt: now + ttl,
  };
  return { status: 200, body: { ok: true, action: agentActionView(actions[actionId]) }, changed: true };
}

/**
 * The single latch. Approved: pending -> executing, and the stored gate (with args) goes back to
 * the Worker to run. Rejected: pending -> denied. Anything else is reported, never re-run.
 */
export function claimGate(
  actions: AgentActions,
  body: { actionId?: string; requesterId?: string; approved?: boolean },
  now: number,
): StoreResult {
  const gate = lookup(actions, String(body.actionId || ''));
  if (!gate) return { status: 404, body: { ok: false, status: 'not_found', error: 'No such action.' }, changed: false };
  if (String(body.requesterId || '') !== gate.requesterId) {
    return { status: 403, body: { ok: false, status: 'forbidden', error: 'This action belongs to another account.' }, changed: false };
  }
  if (gate.status !== 'pending') {
    const status = gate.status === 'expired' || gate.status === 'failed_unknown' ? gate.status : 'already_decided';
    return { status: 409, body: { ok: false, status, action: agentActionView(gate) }, changed: false };
  }
  if (body.approved === true) {
    gate.status = 'executing';
    gate.executingAt = now;
  } else {
    gate.status = 'denied';
    gate.resolvedAt = now;
  }
  return { status: 200, body: { ok: true, status: gate.status, gate }, changed: true };
}

export function finishGate(actions: AgentActions, body: { actionId?: string; ok?: boolean; summary?: string }, now: number): StoreResult {
  const gate = lookup(actions, String(body.actionId || ''));
  if (!gate || gate.status !== 'executing') return { status: 409, body: { ok: false, error: 'Action is not executing.' }, changed: false };
  gate.status = body.ok ? 'approved_done' : 'failed';
  gate.summary = String(body.summary || '').slice(0, 400) || null;
  gate.resolvedAt = now;
  return { status: 200, body: { ok: true, action: agentActionView(gate) }, changed: true };
}
