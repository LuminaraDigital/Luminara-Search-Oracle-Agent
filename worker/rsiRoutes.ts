/**
 * Session routes for the learned skill library.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';
import { skillSuccessRate, type RsiSkill, type SkillProposal } from '../services/rsi/skillLibrary';
import {
  applyRsiProposal,
  curateRsiAccount,
  getRsiSkill,
  listRsiProposals,
  listRsiSkills,
  recordFixObservation,
  recordRsiSkillUsage,
  rollbackRsiSkill,
  RsiUserError,
  setRsiSkillPinned,
} from './rsiSkillStore';

function presentSkill(skill: RsiSkill) {
  return { ...skill, successRate: skillSuccessRate(skill) };
}

function presentProposal(proposal: SkillProposal) {
  return proposal;
}

export async function handleRsiRoute(
  request: Request,
  env: Env,
  user: HostedIdentity,
  path: string,
): Promise<Response | null> {
  if (!path.startsWith('/rsi/')) return null;
  const accountId = billingId(user);
  try {
    if (path === '/rsi/skills' && request.method === 'GET') {
      const url = new URL(request.url);
      const stateParam = url.searchParams.get('state');
      let state: RsiSkill['state'] | undefined;
      if (stateParam) {
        if (stateParam !== 'active' && stateParam !== 'stale' && stateParam !== 'archived') {
          return json({ ok: false, error: 'State must be active, stale, or archived.' }, 400);
        }
        state = stateParam;
      }
      const skills = await listRsiSkills(env, accountId, state);
      return json({ ok: true, skills: skills.map(presentSkill) });
    }

    if (path === '/rsi/skills/observations' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as {
        domain?: string;
        signature?: string;
        title?: string;
        outcome?: 'success' | 'failure';
        sourceRefs?: unknown;
      } | null;
      if (!body) return json({ ok: false, error: 'JSON body required.' }, 400);
      if (body.outcome !== 'success' && body.outcome !== 'failure') {
        return json({ ok: false, error: 'Outcome must be success or failure.' }, 400);
      }
      const sourceRefs = Array.isArray(body.sourceRefs) ? body.sourceRefs.filter((item) => typeof item === 'string') : [];
      const result = await recordFixObservation(env, accountId, {
        domain: body.domain || '',
        signature: body.signature || '',
        title: body.title || '',
        outcome: body.outcome,
        sourceRefs,
      });
      return json({
        ok: true,
        observation: result.observation,
        proposal: result.proposal ? presentProposal(result.proposal) : null,
        reason: result.reason,
      });
    }

    if (path === '/rsi/skills/proposals' && request.method === 'GET') {
      const url = new URL(request.url);
      const statusParam = url.searchParams.get('status');
      let status: SkillProposal['status'] | undefined;
      if (statusParam) {
        if (statusParam !== 'pending' && statusParam !== 'applied' && statusParam !== 'rejected' && statusParam !== 'blocked') {
          return json({ ok: false, error: 'Status must be pending, applied, rejected, or blocked.' }, 400);
        }
        status = statusParam;
      }
      const proposals = await listRsiProposals(env, accountId, status);
      return json({ ok: true, proposals });
    }

    const applyMatch = path.match(/^\/rsi\/skills\/proposals\/([^/]+)\/apply$/);
    if (applyMatch && request.method === 'POST') {
      const result = await applyRsiProposal(env, accountId, decodeURIComponent(applyMatch[1]));
      return json(
        {
          ok: result.ok,
          deferred: result.deferred,
          reason: result.reason,
          proposal: result.proposal,
          skill: result.skill ? presentSkill(result.skill) : null,
        },
        result.ok ? 200 : result.deferred ? 200 : 409,
      );
    }

    if (path === '/rsi/skills/curate' && request.method === 'POST') {
      const result = await curateRsiAccount(env, accountId);
      return json({ ok: true, ...result });
    }

    const usageMatch = path.match(/^\/rsi\/skills\/([^/]+)\/usage$/);
    if (usageMatch && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as { success?: unknown } | null;
      if (!body || typeof body.success !== 'boolean') {
        return json({ ok: false, error: 'Body must include success: true or false.' }, 400);
      }
      const skill = await recordRsiSkillUsage(env, accountId, decodeURIComponent(usageMatch[1]), body.success);
      return json({ ok: true, skill: presentSkill(skill) });
    }

    const pinMatch = path.match(/^\/rsi\/skills\/([^/]+)\/pin$/);
    if (pinMatch && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as { pinned?: unknown } | null;
      if (!body || typeof body.pinned !== 'boolean') {
        return json({ ok: false, error: 'Body must include pinned: true or false.' }, 400);
      }
      const skill = await setRsiSkillPinned(env, accountId, decodeURIComponent(pinMatch[1]), body.pinned);
      return json({ ok: true, skill: presentSkill(skill) });
    }

    const rollbackMatch = path.match(/^\/rsi\/skills\/([^/]+)\/rollback$/);
    if (rollbackMatch && request.method === 'POST') {
      const skill = await rollbackRsiSkill(env, accountId, decodeURIComponent(rollbackMatch[1]));
      return json({ ok: true, skill: presentSkill(skill) });
    }

    const oneMatch = path.match(/^\/rsi\/skills\/([^/]+)$/);
    if (oneMatch && request.method === 'GET') {
      const skill = await getRsiSkill(env, accountId, decodeURIComponent(oneMatch[1]));
      if (!skill) return json({ ok: false, error: 'Skill not found.' }, 404);
      return json({ ok: true, skill: presentSkill(skill) });
    }

    if (path.startsWith('/rsi/')) return json({ ok: false, error: 'Not found.' }, 404);
    return null;
  } catch (err) {
    if (err instanceof RsiUserError) return json({ ok: false, error: err.message }, err.status);
    throw err;
  }
}
