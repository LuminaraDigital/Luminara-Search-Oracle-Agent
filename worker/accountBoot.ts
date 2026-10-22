import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { bearerFromAuthorization } from './firebaseAuth';
import { identify, json, billingId } from './workerUtils';
import {
  buildSessionCookie,
  getSessionTokenFromCookie,
  identifiedForRequest,
  isOpaqueSessionId,
  loadOpaqueSession,
  mintOpaqueSession,
} from './authMiddleware';
import { getOrCreateUserOrg } from './enterpriseStore';
import { readQuotaSnapshot } from './quotaMiddleware';
import { withStageTiming } from './serverTiming';
import { getWorkspace } from './userStore';

async function reuseOrMint(
  request: Request,
  env: Env,
  user: HostedIdentity,
  cookieToken: string | null,
): Promise<string | null> {
  if (user.source !== 'firebase') return null;
  const uid = user.id.replace(/^fb:/, '');
  if (cookieToken && isOpaqueSessionId(cookieToken)) {
    const existing = await loadOpaqueSession(env, cookieToken);
    if (existing?.uid === uid) return null;
  }
  if (!bearerFromAuthorization(request.headers.get('authorization'))) return null;
  return mintOpaqueSession(env, { uid, email: user.email, name: user.name });
}

/**
 * One signed-in read: identity cookie, workspace, and quota.
 * The guard has already verified the caller when this route is protected.
 */
export async function handleAccountBoot(request: Request, env: Env): Promise<Response> {
  const started = performance.now();
  const who = identifiedForRequest(request) ?? await identify(request, env);
  const stamp = (res: Response, dataMs = 0) =>
    withStageTiming(res, env.ENVIRONMENT, started, who.authTiming, dataMs ? { data: dataMs } : {});

  if (who.error || !who.user) {
    return stamp(json({ ok: false, error: who.error || 'Sign in required' }, 401));
  }

  const accountId = billingId(who.user);
  const dataStarted = performance.now();
  const [workspace, quota, org, minted] = await Promise.all([
    getWorkspace(env, accountId),
    readQuotaSnapshot(env, who.user),
    getOrCreateUserOrg(env, who.user),
    reuseOrMint(request, env, who.user, getSessionTokenFromCookie(request)),
  ]);
  const dataMs = performance.now() - dataStarted;
  if (!quota.ok) {
    return stamp(json({ ok: false, error: quota.error, code: quota.code }, 503), dataMs);
  }

  const headers: Record<string, string> = {};
  if (minted) headers['Set-Cookie'] = buildSessionCookie(minted);
  return stamp(json({
    ok: true,
    accountId,
    user: who.user,
    org: {
      id: org.org.id,
      name: org.org.name,
      slug: org.org.slug,
      tier: org.org.tier,
      role: org.membership.role,
    },
    workspace: {
      updatedAt: workspace?.updatedAt ?? 0,
      payload: workspace?.payload ?? {},
    },
    quota,
  }, 200, headers), dataMs);
}
