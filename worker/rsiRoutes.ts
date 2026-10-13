/**
 * Session routes for the learned skill library.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';
import { skillSuccessRate, type RsiSkill, type SkillProposal } from '../services/rsi/skillLibrary';
import {
  getRewardProfile,
  listCorrectionCases,
  nudgeRewardProfile,
  publishGatedPrompt,
  recordCorrection,
  rollbackGatedPrompt,
  rollbackRewardProfile,
  setRewardPinned,
} from './rsiCorrections';
import { countAutomaticRsiChanges } from './rsiSkillStore';
import {
  applyRsiProposal,
  curateRsiAccount,
  getRsiSkill,
  listRsiProposals,
  listRsiSkills,
  recordFixObservation,
  recordRsiSkillUsage,
  rollbackRsiSkill,
  setRsiSkillPinned,
} from './rsiSkillStore';
import { RsiUserError } from './rsiErrors';

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
    if (path === '/rsi/corrections' && request.method === 'GET') {
      const corrections = await listCorrectionCases(env, accountId);
      return json({ ok: true, corrections });
    }

    if (path === '/rsi/corrections' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as {
        domain?: string;
        prompt?: string;
        badExcerpt?: string;
        goodExcerpt?: string;
        sourceRefs?: unknown;
      } | null;
      if (!body) return json({ ok: false, error: 'JSON body required.' }, 400);
      const sourceRefs = Array.isArray(body.sourceRefs) ? body.sourceRefs.filter((item) => typeof item === 'string') : [];
      const correction = await recordCorrection(env, accountId, {
        domain: body.domain || '',
        prompt: body.prompt || '',
        badExcerpt: body.badExcerpt || '',
        goodExcerpt: body.goodExcerpt || '',
        sourceRefs,
      });
      return json({ ok: true, correction });
    }

    if (path === '/rsi/rewards' && request.method === 'GET') {
      const profile = await getRewardProfile(env, accountId);
      return json({ ok: true, ...profile });
    }

    if (path === '/rsi/rewards/outcomes' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as { signals?: unknown; sourceRefs?: unknown } | null;
      if (!body || !Array.isArray(body.signals)) return json({ ok: false, error: 'signals array required.' }, 400);
      const sourceRefs = Array.isArray(body.sourceRefs) ? body.sourceRefs.filter((item) => typeof item === 'string') : [];
      const signals = body.signals.filter((item) => item && typeof item === 'object') as Array<{
        honestyMiss?: boolean;
        budgetMiss?: boolean;
        formatMiss?: boolean;
        groundMiss?: boolean;
        taskSuccess?: boolean;
      }>;
      const result = await nudgeRewardProfile(env, accountId, { signals, sourceRefs });
      return json({ ok: true, ...result });
    }

    if (path === '/rsi/rewards/pin' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as { pinned?: unknown } | null;
      if (!body || typeof body.pinned !== 'boolean') {
        return json({ ok: false, error: 'Body must include pinned: true or false.' }, 400);
      }
      const result = await setRewardPinned(env, accountId, body.pinned);
      return json({ ok: true, ...result });
    }

    if (path === '/rsi/rewards/rollback' && request.method === 'POST') {
      const weights = await rollbackRewardProfile(env, accountId);
      return json({ ok: true, weights });
    }

    if (path === '/rsi/prompts/publish' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as { slug?: string; promptBody?: string; evidenceRefs?: unknown } | null;
      if (!body) return json({ ok: false, error: 'JSON body required.' }, 400);
      const evidenceRefs = Array.isArray(body.evidenceRefs) ? body.evidenceRefs.filter((item) => typeof item === 'string') : [];
      const spent = await countAutomaticRsiChanges(env, accountId);
      const published = await publishGatedPrompt(env, accountId, {
        slug: body.slug || '',
        promptBody: body.promptBody || '',
        evidenceRefs,
        changesAlreadyThisRound: spent,
      });
      return json({ ok: true, version: published.version });
    }

    if (path === '/rsi/prompts/rollback' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as { slug?: string } | null;
      if (!body?.slug) return json({ ok: false, error: 'slug required.' }, 400);
      const result = await rollbackGatedPrompt(env, accountId, body.slug);
      return json({ ok: true, ...result });
    }

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
