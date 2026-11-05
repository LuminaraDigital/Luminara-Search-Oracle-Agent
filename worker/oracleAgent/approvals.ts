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
import type { AgentActionGate, AgentActionView } from '../oracleSession';
import { claimExternalEffect, finalizeExternalEffect } from '../externalEffectsService';
import { getProject } from '../projectService';
import { buildAgentToolContext } from './context';
import { argsHashOf } from './loop';
import { agentToolByName, type AgentTool, type AgentToolContext, type ExternalPreparation } from './toolTable';

type SessionStub = { fetch: (input: string, init?: RequestInit) => Promise<Response> };

export const ACTION_TTL_MS = 30 * 60 * 1000;

export async function parkAction(opts: {
  stub: SessionStub;
  tool: AgentTool;
  prepared: Extract<ExternalPreparation, { ok: true }>;
  ctx: AgentToolContext;
  turnId: string;
}): Promise<{ ok: true; actionId: string } | { ok: false; error: string }> {
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
        ttlMs: ACTION_TTL_MS,
      }),
    })
    .catch(() => null);
  if (!res || !res.ok) return { ok: false, error: 'the approval card could not be stored' };
  return { ok: true, actionId };
}

export type DecideResult = {
  ok: boolean;
  status: 'approved_done' | 'denied' | 'failed' | 'expired' | 'already_decided' | 'failed_unknown' | 'not_found' | 'forbidden' | 'bad_request';
  summary?: string;
  action?: AgentActionView;
};

async function finish(stub: SessionStub, actionId: string, ok: boolean, summary: string): Promise<AgentActionView | undefined> {
  const res = await stub
    .fetch('https://oracle-session/action/finish', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actionId, ok, summary }),
    })
    .catch(() => null);
  const body = res ? ((await res.json().catch(() => ({}))) as { action?: AgentActionView }) : {};
  return body.action;
}

async function appendReceipt(stub: SessionStub, line: string): Promise<void> {
  await stub
    .fetch('https://oracle-session/append', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'assistant', content: line }),
    })
    .catch(() => undefined);
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
  if (!/^[0-9a-f-]{36}$/.test(opts.actionId)) return { ok: false, status: 'bad_request' };
  const accountCtx = await buildAgentToolContext({ env, user, projectId: null, byokHeader: opts.byokHeader, runId: null });
  const claimRes = await stub.fetch('https://oracle-session/action/claim', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actionId: opts.actionId, requesterId: accountCtx.accountId, approved: opts.approved }),
  });
  const claim = (await claimRes.json().catch(() => ({}))) as {
    ok?: boolean;
    status?: string;
    gate?: AgentActionGate;
    action?: AgentActionView;
  };
  if (!claimRes.ok || !claim.ok) {
    const status = (claim.status as DecideResult['status']) || 'not_found';
    return { ok: false, status, action: claim.action };
  }
  const gate = claim.gate!;
  if (gate.status === 'denied') {
    await appendReceipt(stub, `[Oracle] The user rejected: ${gate.preview.split('\n')[0]}`);
    return { ok: true, status: 'denied' };
  }

  const tool = agentToolByName(gate.toolName);
  if (!tool || tool.effect !== 'external' || !tool.execute) {
    const action = await finish(stub, gate.actionId, false, 'This action is no longer available.');
    return { ok: false, status: 'failed', summary: 'This action is no longer available.', action };
  }
  // Re-bind: the signed-in account, the gate's project, ownership checked again now.
  const ctx = await buildAgentToolContext({ env, user, projectId: gate.projectId, byokHeader: opts.byokHeader, runId: null });
  if (gate.projectId && !(await getProject(env, ctx.accountId, gate.projectId))) {
    const action = await finish(stub, gate.actionId, false, 'The project is not available to this account.');
    return { ok: false, status: 'failed', summary: 'The project is not available to this account.', action };
  }
  const gateRefusal = await tool.gate(ctx);
  if (gateRefusal) {
    const action = await finish(stub, gate.actionId, false, gateRefusal);
    return { ok: false, status: 'failed', summary: gateRefusal, action };
  }
  if ((await argsHashOf(gate.toolName, gate.args)) !== gate.argsHash) {
    const action = await finish(stub, gate.actionId, false, 'The stored action did not match its card.');
    return { ok: false, status: 'failed', summary: 'The stored action did not match its card.', action };
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
    const summary = effect.status === 'completed' ? 'This already ran.' : 'We could not confirm this ran. Check before trying again.';
    const action = await finish(stub, gate.actionId, effect.status === 'completed', summary);
    return { ok: false, status: effect.status === 'completed' ? 'already_decided' : 'failed_unknown', summary, action };
  }

  let outcome;
  try {
    outcome = await tool.execute(gate.args, ctx);
  } catch (err) {
    console.error('[oracleAgent] approved action failed', gate.toolName, err instanceof Error ? err.name : 'error');
    // The effect row stays pending: an unknown outcome is never retried.
    const action = await finish(stub, gate.actionId, false, 'We could not confirm this ran. Check before trying again.');
    return { ok: false, status: 'failed_unknown', summary: 'We could not confirm this ran. Check before trying again.', action };
  }
  await finalizeExternalEffect(env, effect.effectKey, ctx.accountId, { ok: !outcome.isError, summary: outcome.summary });
  const action = await finish(stub, gate.actionId, !outcome.isError, outcome.summary);
  await appendReceipt(stub, `[Oracle] ${outcome.isError ? 'Approved but not done' : 'Done after approval'}: ${outcome.summary}`);
  return { ok: !outcome.isError, status: outcome.isError ? 'failed' : 'approved_done', summary: outcome.summary, action };
}
