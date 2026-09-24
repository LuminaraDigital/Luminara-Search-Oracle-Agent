/**
 * Minimal MCP OAuth 2.1 Authorization Code + PKCE (A5).
 * API keys (lm_live_*) remain the primary path; OAuth is additive.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';
import { identify, sha256Hex } from './workerUtils';
import { randomId } from '../services/projects/projectUtils';
import { getActiveSubscription } from './quotaMiddleware';
import { planCapsFor } from './telegramBot';
import { resolveOAuthSigningSecret } from './securityHardening';

const CODES_KV_PREFIX = 'mcp_oauth_code:';
const TOKENS_KV_PREFIX = 'mcp_oauth_token:';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Bearer tokens are stored hashed (SHA-256 hex), mirroring worker/apiKeyService.ts.
 * A KV key of the raw token would let anyone with KV read access impersonate every
 * live MCP session. Lookup hashes the presented token; legacy plaintext records are
 * migrated on first successful read.
 */
async function tokenKvKey(token: string): Promise<string> {
  return `${TOKENS_KV_PREFIX}${await sha256Hex(token)}`;
}

/** App / IDE callback schemes used by local MCP OAuth clients. */
const ALLOWED_REDIRECT_SCHEMES = new Set([
  'cursor:',
  'vscode:',
  'vscode-insiders:',
]);

/**
 * Reject open redirects before issuing a code.
 * Allowed: http(s) to localhost / 127.0.0.1 / ::1, and known IDE schemes (cursor://, vscode://).
 */
export function isAllowedMcpRedirectUri(redirectUri: string): boolean {
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }

  if (ALLOWED_REDIRECT_SCHEMES.has(url.protocol)) {
    // Require a non-empty path or host so bare "cursor:" is rejected.
    return Boolean(url.hostname || url.pathname.length > 1);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase();
  const isLoopback =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host === '::1';
  if (!isLoopback) return false;

  // Prefer http for local MCP clients; https loopback is also accepted.
  return true;
}

function oauthSecretOrNull(env: Env): string | null {
  const resolved = resolveOAuthSigningSecret(env);
  return resolved.ok ? resolved.secret : null;
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = new Uint8Array(digest);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

type AuthCodeRecord = {
  accountId: string;
  userId: string;
  plan: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  createdAt?: number;
};

/**
 * Consume an auth code: delete-first, then treat missing as invalid.
 * A short-lived redeemed gate reduces double-redeem races under KV eventual consistency.
 */
async function consumeAuthCode(env: Env, code: string): Promise<AuthCodeRecord | null> {
  if (!env.LUMINARA_KV) return null;
  const codeKey = `${CODES_KV_PREFIX}${code}`;
  const redeemedKey = `${CODES_KV_PREFIX}redeemed:${code}`;

  const alreadyRedeemed = await env.LUMINARA_KV.get(redeemedKey, { cacheTtl: 0 });
  if (alreadyRedeemed) return null;

  // Claim redemption before reading the code payload.
  await env.LUMINARA_KV.put(redeemedKey, '1', { expirationTtl: 600 });

  const raw = await env.LUMINARA_KV.get(codeKey, { cacheTtl: 0 });
  await env.LUMINARA_KV.delete(codeKey);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuthCodeRecord;
  } catch {
    return null;
  }
}

export async function handleMcpOAuthRoute(
  request: Request,
  env: Env,
  path: string,
): Promise<Response | null> {
  if (path === '/oauth/mcp/authorize' && request.method === 'GET') {
    return authorize(request, env);
  }
  if (path === '/oauth/mcp/token' && request.method === 'POST') {
    return token(request, env);
  }
  if (path === '/oauth/mcp/.well-known/oauth-authorization-server' && request.method === 'GET') {
    const origin = new URL(request.url).origin;
    return json({
      issuer: origin,
      authorization_endpoint: `${origin}/api/oauth/mcp/authorize`,
      token_endpoint: `${origin}/api/oauth/mcp/token`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['mcp:free', 'mcp:research'],
    });
  }
  return null;
}

async function authorize(request: Request, env: Env): Promise<Response> {
  if (!oauthSecretOrNull(env)) {
    return json(
      {
        error: 'server_error',
        error_description: 'MCP OAuth is not configured. Set MCP_OAUTH_SECRET.',
      },
      503,
    );
  }

  const url = new URL(request.url);
  const redirectUri = url.searchParams.get('redirect_uri') || '';
  const state = url.searchParams.get('state') || '';
  const codeChallenge = url.searchParams.get('code_challenge') || '';
  const method = url.searchParams.get('code_challenge_method') || 'S256';
  const scope = url.searchParams.get('scope') || 'mcp:free';

  if (!redirectUri || !codeChallenge || method !== 'S256') {
    return json({ error: 'invalid_request', error_description: 'redirect_uri and S256 code_challenge required' }, 400);
  }

  if (!isAllowedMcpRedirectUri(redirectUri)) {
    return json(
      {
        error: 'invalid_request',
        error_description:
          'redirect_uri not allowed. Use http(s)://localhost (or 127.0.0.1) or a known IDE scheme (cursor://, vscode://).',
      },
      400,
    );
  }

  const who = await identify(request, env);
  if (who.error || !who.user) {
    return json(
      {
        error: 'login_required',
        error_description: 'Sign in to Luminara first, then retry authorize with session cookie.',
      },
      401,
    );
  }

  const sub = await getActiveSubscription(env, who.user);
  const caps = planCapsFor(sub?.plan || 'free');
  if (!caps.mcpAccess) {
    return json({ error: 'access_denied', error_description: 'Growth+ plan required for MCP' }, 403);
  }

  const scopes = scope.split(/\s+/).filter(Boolean);
  if (scopes.includes('mcp:research') && !caps.apiAccess) {
    // Research scope only for Agency; Growth still gets mcp:free
  }

  const code = randomId('oc', 16);
  const record: AuthCodeRecord = {
    accountId: billingId(who.user),
    userId: who.user.id,
    plan: sub?.plan || 'free',
    redirectUri,
    codeChallenge,
    scope: scopes.includes('mcp:research') && caps.apiAccess ? 'mcp:free mcp:research' : 'mcp:free',
    createdAt: Date.now(),
  };

  if (!env.LUMINARA_KV) return json({ error: 'server_error', error_description: 'KV unavailable' }, 503);
  await env.LUMINARA_KV.put(`${CODES_KV_PREFIX}${code}`, JSON.stringify(record), { expirationTtl: 300 });

  const redirect = new URL(redirectUri);
  redirect.searchParams.set('code', code);
  if (state) redirect.searchParams.set('state', state);
  return Response.redirect(redirect.toString(), 302);
}

async function token(request: Request, env: Env): Promise<Response> {
  if (!oauthSecretOrNull(env)) {
    return json(
      {
        error: 'server_error',
        error_description: 'MCP OAuth is not configured. Set MCP_OAUTH_SECRET.',
      },
      503,
    );
  }

  const contentType = request.headers.get('content-type') || '';
  let body: Record<string, string> = {};
  if (contentType.includes('application/json')) {
    body = (await request.json().catch(() => ({}))) as Record<string, string>;
  } else {
    const form = await request.formData();
    form.forEach((v, k) => {
      body[k] = String(v);
    });
  }

  if (body.grant_type !== 'authorization_code') {
    return json({ error: 'unsupported_grant_type' }, 400);
  }
  const code = body.code || '';
  const redirectUri = body.redirect_uri || '';
  const verifier = body.code_verifier || '';
  if (!code || !redirectUri || !verifier) {
    return json({ error: 'invalid_request' }, 400);
  }

  if (!env.LUMINARA_KV) return json({ error: 'server_error' }, 503);

  const record = await consumeAuthCode(env, code);
  if (!record) return json({ error: 'invalid_grant' }, 400);

  if (record.redirectUri !== redirectUri) return json({ error: 'invalid_grant' }, 400);

  const challenge = await sha256Base64Url(verifier);
  if (challenge !== record.codeChallenge) return json({ error: 'invalid_grant', error_description: 'PKCE failed' }, 400);

  const accessToken = `mcp_${randomId('tok', 20)}`;
  const tokenRecord = {
    accountId: record.accountId,
    userId: record.userId,
    plan: record.plan,
    scope: record.scope,
    createdAt: Date.now(),
  };
  // Store under the SHA-256 hex of the token so the raw bearer value never lands in KV.
  await env.LUMINARA_KV.put(await tokenKvKey(accessToken), JSON.stringify(tokenRecord), {
    expirationTtl: TOKEN_TTL_SECONDS,
  });

  return json({
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: TOKEN_TTL_SECONDS,
    scope: record.scope,
  });
}

type StoredTokenRecord = {
  accountId: string;
  userId: string;
  plan: string;
  scope: string;
  createdAt?: number;
};

/** Resolve Bearer mcp_* OAuth token to a HostedIdentity-like identity. */
export async function identifyMcpOAuthToken(
  env: Env,
  token: string,
): Promise<{ user: HostedIdentity; plan: string; scope: string } | null> {
  if (!token.startsWith('mcp_') || !env.LUMINARA_KV) return null;

  // Primary path: hashed record.
  const raw = await env.LUMINARA_KV.get(await tokenKvKey(token));
  if (raw) return parseTokenRecord(raw);

  // Legacy migration: records written before hashing keyed KV by the raw token.
  // On a valid hit, copy to the hashed key (same metadata + a fresh 30-day TTL)
  // and delete the plaintext original so existing live sessions survive the cutover.
  const legacyKey = `${TOKENS_KV_PREFIX}${token}`;
  const legacyRaw = await env.LUMINARA_KV.get(legacyKey);
  if (!legacyRaw) return null;
  const parsed = parseTokenRecord(legacyRaw);
  if (!parsed) return null;
  try {
    await env.LUMINARA_KV.put(await tokenKvKey(token), legacyRaw, { expirationTtl: TOKEN_TTL_SECONDS });
    await env.LUMINARA_KV.delete(legacyKey);
  } catch (err) {
    // Migration is best-effort; the plaintext record keeps working until KV recovers.
    console.error('[mcp-oauth] legacy token migration failed (read path still served):', err instanceof Error ? err.message : err);
  }
  return parsed;
}

function parseTokenRecord(raw: string): { user: HostedIdentity; plan: string; scope: string } | null {
  try {
    const record = JSON.parse(raw) as StoredTokenRecord;
    if (!record?.accountId || !record?.scope) return null;
    const user: HostedIdentity = {
      id: record.userId || `oauth:${record.accountId}`,
      source: 'firebase',
      accountId: record.accountId,
      name: 'MCP OAuth',
    };
    return { user, plan: record.plan, scope: record.scope };
  } catch {
    return null;
  }
}
