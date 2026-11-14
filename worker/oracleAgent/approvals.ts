/**
 * Approval cards (Blueprint section 5 and section 13 items 1-5).
 *
 * park: the loop stores an external action in the chat's OracleSession object. Nothing runs.
 * decide: the user approves or rejects. The session object is the single latch (pending ->
 * executing happens once). The Worker then runs the stored args as the signed-in account, behind a
 * single-use effect claim, and records the outcome. Request bodies never supply arguments.
 */
import type { Env } from '../env';
import type { HostedIdentity } from '../userTypes';
import { claimExternalEffect, finalizeExternalEffect } from '../externalEffectsService';
import { auditOrgIdFor, recordAuditLogBestEffort } from '../auditLog';
import { getActiveSubscription } from '../quotaMiddleware';
import { planCapsFor } from '../telegramBot';
import { billingId } from '../workerUtils';
import { AGENT_ACTION_TTL_MS, type AgentActionGate, type AgentActionView } from './actionStore';
import { buildAgentToolContext } from './context';
import { argsHashOf } from './loop';
import { agentToolByName } from './toolTable';
import type { AgentTool, AgentToolContext, ExternalPreparation } from './types';

type SessionStub = { fetch: (input: string, init?: RequestInit) => Promise<Response> };

/** Session-route actions every signed-in plan may use when the agent is on. */
export const AGENT_SESSION_ACTIONS = ['approval', 'history', 'events'] as const;
const NARROW_GET = new Set<string>(['history', 'events']);

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function parkAction(opts: {
  stub: SessionStub;
  tool: AgentTool;
  prepared: Extract<ExternalPreparation, { ok: true }>;
  ctx: AgentToolContext;
  turnId: string;
}): Promise<{ ok: true; actionId: string; expiresAt: number } | { ok: false; error: string }> {
  const actionId = crypto.randomUUID();
  const res = await opts.stub
    .fetch('https://oracle-session/action/park', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        actionId,
        toolName: opts.tool.name,
        args: opts.prepared.args,
        argsHash: await argsHashOf(opts.tool.name, opts.prepared.args),
        projectId: opts.ctx.projectId,
        requesterId: opts.ctx.accountId,
        preview: opts.prepared.preview,
        costNote: opts.prepared.costNote,
        // Slice 1 marks every card: project context, audits, memory and history can all carry web text.
        tainted: true,
        turnId: opts.turnId,
        ttlMs: AGENT_ACTION_TTL_MS,
      }),
    })
    .catch(() => null);
  const body = res ? ((await res.json().catch(() => ({}))) as { action?: AgentActionView }) : {};
  if (!res || !res.ok || !body.action) return { ok: false, error: 'the approval card could not be stored' };
  return { ok: true, actionId, expiresAt: body.action.expiresAt };
}

export type DecideStatus =
  | 'approved_done'
  | 'denied'
  | 'failed'
  | 'expired'
  | 'already_decided'
  | 'failed_unknown'
  | 'not_found'
  | 'forbidden'
  | 'bad_request';

export type DecideResult = { ok: boolean; status: DecideStatus; summary?: string; action?: AgentActionView };

const HTTP_FOR: Record<DecideStatus, number> = {
  approved_done: 200,
  denied: 200,
  failed: 409,
  expired: 409,
  already_decided: 409,
  failed_unknown: 409,
  not_found: 404,
  forbidden: 403,
  bad_request: 400,
};

const UNKNOWN_OUTCOME = 'We could not confirm this ran. Check before trying again.';

async function stubJson<T>(stub: SessionStub, path: string, body: unknown): Promise<{ res: Response | null; data: T }> {
  const res = await stub
    .fetch(`https://oracle-session/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    .catch(() => null);
  const data = (res ? await res.json().catch(() => ({})) : {}) as T;
  return { res, data };
}

async function finish(stub: SessionStub, actionId: string, ok: boolean, summary: string): Promise<AgentActionView | undefined> {
  const { data } = await stubJson<{ action?: AgentActionView }>(stub, 'action/finish', { actionId, ok, summary });
  return data.action;
}

async function fail(stub: SessionStub, gate: AgentActionGate, status: DecideStatus, summary: string, okFinish = false): Promise<DecideResult> {
  const action = await finish(stub, gate.actionId, okFinish, summary);
  return { ok: false, status, summary, action };
}

async function appendReceipt(stub: SessionStub, line: string): Promise<void> {
  await stubJson(stub, 'append', { role: 'assistant', content: line });
}

export async function decideAction(opts: {
  env: Env;
  user: HostedIdentity;
  stub: SessionStub;
  actionId: string;
  approved: boolean;
  byokHeader: string | null;
}): Promise<DecideResult> {
  const { env, user, stub } = opts;
  const { res: claimRes, data: claim } = await stubJson<{ ok?: boolean; status?: DecideStatus; gate?: AgentActionGate; action?: AgentActionView }>(
    stub,
    'action/claim',
    { actionId: opts.actionId, requesterId: billingId(user), approved: opts.approved },
  );
  if (!claimRes || !claimRes.ok || !claim.ok || !claim.gate) {
    return { ok: false, status: claim.status || 'not_found', action: claim.action };
  }
  const gate = claim.gate;
  if (gate.status === 'denied') {
    await appendReceipt(stub, `[Oracle] The user rejected: ${gate.preview.split('\n')[0]}`);
    return { ok: true, status: 'denied' };
  }

  const tool = agentToolByName(gate.toolName);
  if (!tool || tool.effect !== 'external' || !tool.execute) return fail(stub, gate, 'failed', 'This action is no longer available.');
  // Re-bind: the signed-in account, the card's project, ownership checked again now.
  const ctx = await buildAgentToolContext({ env, user, projectId: gate.projectId, byokHeader: opts.byokHeader, runId: null });
  if (gate.projectId && !ctx.projectId) return fail(stub, gate, 'failed', 'The project is not available to this account.');
  const refusal = await tool.gate(ctx);
  if (refusal) return fail(stub, gate, 'failed', refusal);
  if ((await argsHashOf(gate.toolName, gate.args)) !== gate.argsHash) {
    return fail(stub, gate, 'failed', 'The stored action did not match its card.');
  }

  const effect = await claimExternalEffect(env, {
    actionId: gate.actionId,
    accountId: ctx.accountId,
    projectId: gate.projectId,
    targetSystem: 'luminara',
    actionKind: gate.toolName,
    payloadHash: gate.argsHash,
  });
  if (!effect.claimed) {
    // Someone else holds this effect, or the outcome is unknown: never run it twice.
    return effect.status === 'completed'
      ? fail(stub, gate, 'already_decided', 'This already ran.', true)
      : fail(stub, gate, 'failed_unknown', UNKNOWN_OUTCOME);
  }

  let outcome;
  try {
    outcome = await tool.execute(gate.args, ctx);
  } catch (err) {
    console.error('[oracleAgent] approved action failed', gate.toolName, err instanceof Error ? err.name : 'error');
    // The effect row stays pending: an unknown outcome is never retried.
    return fail(stub, gate, 'failed_unknown', UNKNOWN_OUTCOME);
  }
  await finalizeExternalEffect(env, effect.effectKey, ctx.accountId, { ok: !outcome.isError, summary: outcome.summary });
  const action = await finish(stub, gate.actionId, !outcome.isError, outcome.summary);
  await appendReceipt(stub, `[Oracle] ${outcome.isError ? 'Approved but not done' : 'Done after approval'}: ${outcome.summary}`);
  return { ok: !outcome.isError, status: outcome.isError ? 'failed' : 'approved_done', summary: outcome.summary, action };
}

/**
 * Session-route access while the agent is on. Agency keeps its own session ids and every action;
 * other plans get one fixed session and only AGENT_SESSION_ACTIONS ('approval' as POST only).
 * 'default' names the chat's default session, which the client cannot spell.
 */
export async function agentSessionAccess(opts: {
  env: Env;
  user: HostedIdentity;
  method: string;
  actionPath: string;
  sessionIdRaw: string;
}): Promise<{ response: Response } | { sessionId: string; agencyAccess: boolean }> {
  const { env, user } = opts;
  const agencyAccess = planCapsFor((await getActiveSubscription(env, user))?.plan || 'free').apiAccess;
  const fixed = `sess_${user.id}`;
  if (agencyAccess) {
    const raw = opts.sessionIdRaw === 'default' ? '' : opts.sessionIdRaw;
    return { sessionId: String(raw || fixed).slice(0, 128), agencyAccess };
  }
  const allowed = opts.method === 'GET' ? NARROW_GET.has(opts.actionPath) : opts.method === 'POST' && opts.actionPath === 'approval';
  if (!allowed) return { response: jsonResponse({ ok: false, error: 'Not available on this plan', code: 'PLAN_LIMIT' }, 403) };
  return { sessionId: fixed, agencyAccess };
}

/**
 * POST approval with an actionId decides an agent card. Returns null when the body is the legacy
 * gate shape (toolId), which Agency keeps; other plans get a 400 for it.
 */
export async function handleAgentActionDecision(opts: {
  env: Env;
  user: HostedIdentity;
  stub: SessionStub;
  bodyText: string;
  sessionId: string;
  agencyAccess: boolean;
  byokHeader: string | null;
}): Promise<Response | null> {
  let parsed: { actionId?: unknown; approved?: unknown } = {};
  try {
    parsed = JSON.parse(opts.bodyText || '{}') as typeof parsed;
  } catch {
    parsed = {};
  }
  if (typeof parsed.actionId !== 'string') {
    return opts.agencyAccess ? null : jsonResponse({ ok: false, error: 'actionId required', code: 'BAD_REQUEST' }, 400);
  }
  // Arguments come from the stored card, never from this request body.
  const decided = await decideAction({
    env: opts.env,
    user: opts.user,
    stub: opts.stub,
    actionId: parsed.actionId,
    approved: parsed.approved === true,
    byokHeader: opts.byokHeader,
  });
  await recordAuditLogBestEffort(opts.env, {
    org_id: auditOrgIdFor(billingId(opts.user)),
    actor_id: opts.user.id,
    action: decided.status === 'approved_done' ? 'oracle_tool_allow' : 'oracle_tool_block',
    target_id: decided.action?.toolName || 'agent_action',
    details: { surface: 'agent_action', sessionId: opts.sessionId, status: decided.status },
  });
  return jsonResponse(decided, HTTP_FOR[decided.status]);
}
