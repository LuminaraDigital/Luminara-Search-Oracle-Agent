/**
 * Builds the tool context for a signed-in user. Used by the chat loop and again at approval time,
 * so an approved action always runs as the signed-in account, never as anything stored or sent.
 * A project the account does not own is dropped here, so no tool can reach it.
 */
import type { Env } from '../env';
import type { HostedIdentity } from '../userTypes';
import { billingId } from '../workerUtils';
import { getActiveSubscription } from '../quotaMiddleware';
import { getProject } from '../projectService';
import { entitlementsFor, normalizePlanId } from '../../services/plans/planEntitlements';
import { hasDataForSeoCredentials } from '../../services/config/runtimeKeys';
import { agentLimitsFor } from './limits';
import type { AgentToolContext } from './types';

export async function buildAgentToolContext(opts: {
  env: Env;
  user: HostedIdentity;
  projectId: string | null;
  byokHeader: string | null;
  runId: string | null;
  unattended?: boolean;
}): Promise<AgentToolContext> {
  const accountId = billingId(opts.user);
  const [sub, project] = await Promise.all([
    getActiveSubscription(opts.env, opts.user),
    opts.projectId ? getProject(opts.env, accountId, opts.projectId) : Promise.resolve(null),
  ]);
  const plan = normalizePlanId(sub?.plan);
  const byok = opts.byokHeader?.trim() || null;
  const dfsCred = byok && hasDataForSeoCredentials({ luminara_dataforseo_key: byok }) ? byok : null;
  return {
    env: opts.env,
    user: opts.user,
    accountId,
    projectId: project ? project.id : null,
    projectDomain: project?.domain ? project.domain.toLowerCase() : null,
    plan,
    canUsePaid: entitlementsFor(plan).apiAccess || Boolean(dfsCred),
    dfsCred,
    runId: opts.runId,
    limits: agentLimitsFor(plan, opts.env.ORACLE_AGENT_LIMITS),
    unattended: Boolean(opts.unattended),
    state: { contextLoaded: false, paidCalls: 0 },
  };
}
