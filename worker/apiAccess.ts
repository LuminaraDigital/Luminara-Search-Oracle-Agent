/**
 * Agency API access gate for /api/oracle, /api/audit, /api/tools.
 * MCP free tools use guardMcpAccess (Growth+) instead.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { getActiveSubscription } from './quotaMiddleware';
import { planCapsFor } from './telegramBot';
import { identify, json } from './workerUtils';
import { identifyApiKey } from './apiKeyService';
import { bearerFromAuthorization } from './firebaseAuth';
import { identifyMcpOAuthToken } from './mcpOAuth';

/** Paths that require an Agency (apiAccess) plan in addition to authentication. */
export const API_ACCESS_PATH_PATTERNS: RegExp[] = [
  /^\/oracle(\/|$)/,
  /^\/audit(\/|$)/,
  /^\/tools(\/|$)/,
];

/** MCP requires Growth+ mcpAccess (not full Agency apiAccess). */
export const MCP_ACCESS_PATH_PATTERNS: RegExp[] = [/^\/mcp(\/|$)/];

export function isApiAccessRoute(path: string): boolean {
  return API_ACCESS_PATH_PATTERNS.some((re) => re.test(path));
}

export function isMcpAccessRoute(path: string): boolean {
  return MCP_ACCESS_PATH_PATTERNS.some((re) => re.test(path));
}

/**
 * Returns a 403 Response when the caller's plan lacks apiAccess; otherwise null.
 * Caller must already be authenticated.
 */
export async function requireApiAccess(env: Env, user: HostedIdentity): Promise<Response | null> {
  const sub = await getActiveSubscription(env, user);
  const caps = planCapsFor(sub?.plan);
  if (!caps.apiAccess) {
    return json(
      {
        ok: false,
        error: 'Agency API access requires an active Pro / Agency plan. Upgrade or use the web app.',
        code: 'API_ACCESS_REQUIRED',
        requiredPlan: 'agency',
      },
      403,
    );
  }
  return null;
}

export async function requireMcpAccess(env: Env, user: HostedIdentity): Promise<Response | null> {
  const sub = await getActiveSubscription(env, user);
  const caps = planCapsFor(sub?.plan);
  if (!caps.mcpAccess) {
    return json(
      {
        ok: false,
        error: 'MCP access requires Growth or Agency. Upgrade, or use the web app.',
        code: 'MCP_ACCESS_REQUIRED',
        requiredPlan: 'growth',
      },
      403,
    );
  }
  return null;
}

/**
 * Auth + apiAccess for Agency API surfaces.
 * 401 if unsigned; 403 if signed but plan lacks apiAccess; null if allowed.
 */
export async function guardApiAccessRoute(
  request: Request,
  env: Env,
  path: string,
): Promise<Response | null> {
  if (!isApiAccessRoute(path)) return null;
  const who = await identify(request, env);
  if (who.error || !who.user) {
    return json(
      {
        ok: false,
        error: who.error || 'Unauthorized: Authentication required',
        code: 'AUTH_REQUIRED',
      },
      401,
      { 'WWW-Authenticate': 'Bearer error="invalid_token", Cookie name="__session"' },
    );
  }
  return requireApiAccess(env, who.user);
}

/**
 * Resolve session/Firebase/Telegram or lm_live_* API key, then require mcpAccess.
 * Returns { response } on failure, or { user } on success.
 */
export async function resolveMcpUser(
  request: Request,
  env: Env,
): Promise<{ user: HostedIdentity } | { response: Response }> {
  const bearer = bearerFromAuthorization(request.headers.get('authorization'));
  const apiUser = await identifyApiKey(env, bearer);
  if (apiUser) {
    const denied = await requireMcpAccess(env, apiUser);
    if (denied) return { response: denied };
    return { user: apiUser };
  }

  const oauth = bearer ? await identifyMcpOAuthToken(env, bearer) : null;
  if (oauth) {
    const denied = await requireMcpAccess(env, oauth.user);
    if (denied) return { response: denied };
    return { user: oauth.user };
  }

  const who = await identify(request, env);
  if (who.error || !who.user) {
    return {
      response: json(
        {
          ok: false,
          error: who.error || 'Unauthorized: Authentication required',
          code: 'AUTH_REQUIRED',
        },
        401,
        { 'WWW-Authenticate': 'Bearer error="invalid_token", Cookie name="__session"' },
      ),
    };
  }
  const denied = await requireMcpAccess(env, who.user);
  if (denied) return { response: denied };
  return { user: who.user };
}

export async function guardMcpAccessRoute(
  request: Request,
  env: Env,
  path: string,
): Promise<Response | null> {
  if (!isMcpAccessRoute(path)) return null;
  const resolved = await resolveMcpUser(request, env);
  if ('response' in resolved) return resolved.response;
  return null;
}
