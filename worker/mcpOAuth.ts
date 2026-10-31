/**
 * Minimal MCP OAuth 2.1 Authorization Code + PKCE (A5).
 * API keys (lm_live_*) remain the primary path; OAuth is additive.
 */
import type { Env } from './env';
import type { HostedIdentity } from './userTypes';
import { billingId, json } from './workerUtils';
import { identify, sha256Hex } from './workerUtils';
import { escapeHtml } from './marketingShell';
import { randomId } from '../services/projects/projectUtils';
import { getActiveSubscription } from './quotaMiddleware';
import { planCapsFor } from './telegramBot';
import { resolveOAuthSigningSecret } from './securityHardening';

const CODES_KV_PREFIX = 'mcp_oauth_code:';
const TOKENS_KV_PREFIX = 'mcp_oauth_token:';
const CLIENTS_KV_PREFIX = 'mcp_oauth_client:';
const CONSENTS_KV_PREFIX = 'mcp_oauth_consent:';
const CONNECTIONS_KV_PREFIX = 'mcp_oauth_connection:';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
/** Long enough to outlive a token, refreshed on each authorize so an active client never expires. */
const CLIENT_TTL_SECONDS = 60 * 60 * 24 * 90;
const CONSENT_TTL_SECONDS = 600;
const MAX_CLIENT_REDIRECT_URIS = 5;
/** Hosted connector clients never spend: the owner upgrades or buys research in the app. */
const CONNECTOR_SCOPE = 'mcp:free';

export const MCP_OAUTH_PUBLIC_CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, mcp-protocol-version',
};

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

/**
 * Hosted agents (Grok connectors and the like) call back to their own https origin. Any https
 * host may register, so the exact match against the client record and the consent screen are
 * what protect the account, not this shape check.
 */
export function isAllowedConnectorRedirectUri(redirectUri: string): boolean {
  if (isAllowedMcpRedirectUri(redirectUri)) return true;
  try {
    const url = new URL(redirectUri);
    return url.protocol === 'https:' && !url.hash && !url.username && !url.password;
  } catch {
    return false;
  }
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
  /** Set on the connector flow: the token call must present the same client. */
  clientId?: string;
  clientName?: string;
};

type RegisteredClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: number;
};

/** One pending approval, bound to the signed-in user who saw the screen. */
type ConsentRecord = {
  userId: string;
  accountId: string;
  plan: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
};

/** KV refuses a get with cacheTtl under 30 seconds, so 30 is the shortest edge cache it allows. */
const SHORTEST_KV_CACHE_TTL_SECONDS = 30;

/**
 * Consume an auth code: delete-first, then treat missing as invalid.
 * A short-lived redeemed gate reduces double-redeem races under KV eventual consistency.
 */
async function consumeAuthCode(env: Env, code: string): Promise<AuthCodeRecord | null> {
  if (!env.LUMINARA_KV) return null;
  const codeKey = `${CODES_KV_PREFIX}${code}`;
  const redeemedKey = `${CODES_KV_PREFIX}redeemed:${code}`;

  const alreadyRedeemed = await env.LUMINARA_KV.get(redeemedKey, { cacheTtl: SHORTEST_KV_CACHE_TTL_SECONDS });
  if (alreadyRedeemed) return null;

  // Claim redemption before reading the code payload.
  await env.LUMINARA_KV.put(redeemedKey, '1', { expirationTtl: 600 });

  const raw = await env.LUMINARA_KV.get(codeKey, { cacheTtl: SHORTEST_KV_CACHE_TTL_SECONDS });
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
  if (path === '/oauth/mcp/authorize' && request.method === 'POST') {
    return decideConsent(request, env);
  }
  if (path === '/oauth/mcp/token' && request.method === 'POST') {
    return token(request, env);
  }
  if (path === '/oauth/mcp/register' && request.method === 'POST') {
    return registerClient(request, env);
  }
  if (path === '/oauth/mcp/.well-known/oauth-authorization-server' && request.method === 'GET') {
    return json(authorizationServerMetadata(new URL(request.url).origin));
  }
  return null;
}

function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/mcp/authorize`,
    token_endpoint: `${origin}/api/oauth/mcp/token`,
    registration_endpoint: `${origin}/api/oauth/mcp/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['mcp:free', 'mcp:research'],
  };
}

/** Where a 401 from /api/mcp sends an MCP client to discover how to sign in (RFC 9728). */
export function mcpResourceMetadataUrl(request: Request): string {
  return `${new URL(request.url).origin}/.well-known/oauth-protected-resource/api/mcp`;
}

/**
 * RFC 9728 and RFC 8414 discovery. Lives outside /api because clients derive these paths from the
 * server URL, and it answers on every host so the www redirect cannot move the issuer.
 */
export function handleOAuthDiscovery(request: Request): Response | null {
  if (request.method !== 'GET') return null;
  const url = new URL(request.url);
  const cors = { 'Access-Control-Allow-Origin': '*' };
  if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
    return json(
      {
        resource: `${url.origin}/api/mcp`,
        resource_name: 'Luminara Suite',
        authorization_servers: [url.origin],
        scopes_supported: [CONNECTOR_SCOPE],
        bearer_methods_supported: ['header'],
      },
      200,
      cors,
    );
  }
  if (url.pathname.startsWith('/.well-known/oauth-authorization-server')) {
    return json(authorizationServerMetadata(url.origin), 200, cors);
  }
  return null;
}

/** RFC 7591 registration for public clients. Open by design: approval happens per user at consent. */
async function registerClient(request: Request, env: Env): Promise<Response> {
  if (!env.LUMINARA_KV) return json({ error: 'server_error', error_description: 'KV unavailable' }, 503);
  const body = (await request.json().catch(() => null)) as { client_name?: unknown; redirect_uris?: unknown } | null;
  const redirectUris: unknown[] = Array.isArray(body?.redirect_uris) ? body.redirect_uris : [];
  const valid =
    redirectUris.length > 0 &&
    redirectUris.length <= MAX_CLIENT_REDIRECT_URIS &&
    redirectUris.every((uri) => typeof uri === 'string' && isAllowedConnectorRedirectUri(uri));
  if (!valid) {
    return json(
      {
        error: 'invalid_redirect_uri',
        error_description: `Send 1 to ${MAX_CLIENT_REDIRECT_URIS} redirect_uris, each https, loopback, or a known IDE scheme.`,
      },
      400,
    );
  }
  const rawName = typeof body?.client_name === 'string' ? body.client_name.trim() : '';
  const client: RegisteredClient = {
    clientId: randomId('mcpc', 16),
    clientName: rawName.slice(0, 80) || 'Unnamed agent',
    redirectUris: redirectUris as string[],
    createdAt: Date.now(),
  };
  await env.LUMINARA_KV.put(`${CLIENTS_KV_PREFIX}${client.clientId}`, JSON.stringify(client), {
    expirationTtl: CLIENT_TTL_SECONDS,
  });
  return json(
    {
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    201,
  );
}

async function loadClient(env: Env, clientId: string): Promise<RegisteredClient | null> {
  const raw = await env.LUMINARA_KV?.get(`${CLIENTS_KV_PREFIX}${clientId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RegisteredClient;
  } catch {
    return null;
  }
}

/** form-action must name the callback or the browser blocks the redirect after Allow. */
function consentCsp(redirectUri: string): string {
  const url = new URL(redirectUri);
  const callback = url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : url.protocol;
  return `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${callback}; frame-ancestors 'none'; base-uri 'none'`;
}

function agentPage(title: string, inner: string, status: number, csp: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#000;color:#f4efe3;font:16px/1.55 system-ui,sans-serif;padding:16px}main{max-width:440px;border:1px solid #6b5a2e;border-radius:20px;padding:28px;background:#0d0c09}h1{font:400 28px/1.15 Georgia,serif;margin:0 0 12px}li{margin:6px 0}code{word-break:break-all}.row{display:flex;gap:12px;margin-top:20px}button,a.btn{flex:1;text-align:center;padding:12px;border-radius:12px;border:1px solid #d4af37;background:transparent;color:#f4efe3;font:inherit;cursor:pointer;text-decoration:none}button[value=allow],a.btn{background:#d4af37;color:#000}</style></head><body><main>${inner}</main></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': csp },
  });
}

async function connectorAuthorize(
  request: Request,
  env: Env,
  params: { clientId: string; redirectUri: string; codeChallenge: string; state: string },
): Promise<Response> {
  const client = await loadClient(env, params.clientId);
  // Never redirect on a bad client or callback: that is the open-redirect case.
  if (!client) return json({ error: 'invalid_client', error_description: 'Unknown client_id. Register first.' }, 400);
  if (!client.redirectUris.includes(params.redirectUri)) {
    return json({ error: 'invalid_request', error_description: 'redirect_uri is not registered for this client.' }, 400);
  }
  await env.LUMINARA_KV?.put(`${CLIENTS_KV_PREFIX}${client.clientId}`, JSON.stringify(client), {
    expirationTtl: CLIENT_TTL_SECONDS,
  });

  const who = await identify(request, env);
  if (who.error || !who.user) {
    const url = new URL(request.url);
    const target = `${url.pathname}${url.search}`;
    // Relative on purpose: the apex redirects to www, where the session cookie lives.
    return new Response(null, { status: 302, headers: { Location: `/?agent_connect=${encodeURIComponent(target)}` } });
  }

  const sub = await getActiveSubscription(env, who.user);
  const plan = sub?.plan || 'free';
  const name = escapeHtml(client.clientName);
  if (!planCapsFor(plan).mcpAccess) {
    return agentPage(
      'Upgrade to connect',
      `<h1>${name} needs a plan with agent access</h1><p>Your plan does not include agent connections yet. Only you can upgrade: agents cannot buy for you.</p><div class="row"><a class="btn" href="/pricing">See plans</a></div>`,
      403,
      consentCsp(params.redirectUri),
    );
  }

  if (!env.LUMINARA_KV) return json({ error: 'server_error', error_description: 'KV unavailable' }, 503);
  const consentId = randomId('oconsent', 16);
  const record: ConsentRecord = {
    userId: who.user.id,
    accountId: billingId(who.user),
    plan,
    clientId: client.clientId,
    clientName: client.clientName,
    redirectUri: params.redirectUri,
    codeChallenge: params.codeChallenge,
    state: params.state,
  };
  await env.LUMINARA_KV.put(`${CONSENTS_KV_PREFIX}${consentId}`, JSON.stringify(record), {
    expirationTtl: CONSENT_TTL_SECONDS,
  });
  const callback = new URL(params.redirectUri);
  return agentPage(
    'Connect an agent',
    `<h1>Let ${name} use your Luminara account?</h1><p>The agent picked this name itself. Check that you started this connection and that you trust <code>${escapeHtml(callback.host || callback.protocol)}</code>, where it returns.</p><ul><li>Read your projects, business context and reports</li><li>Save reports and update project context</li><li>Cannot pay, change your plan, or spend research credits</li></ul><form method="post" action="/api/oauth/mcp/authorize"><input type="hidden" name="consent" value="${consentId}"><div class="row"><button name="decision" value="deny">Cancel</button><button name="decision" value="allow">Allow</button></div></form>`,
    200,
    consentCsp(params.redirectUri),
  );
}

async function decideConsent(request: Request, env: Env): Promise<Response> {
  if (!env.LUMINARA_KV) return json({ error: 'server_error', error_description: 'KV unavailable' }, 503);
  if (!oauthSecretOrNull(env)) {
    return json({ error: 'server_error', error_description: 'MCP OAuth is not configured. Set MCP_OAUTH_SECRET.' }, 503);
  }
  const form = await request.formData().catch(() => null);
  const consentId = String(form?.get('consent') ?? '');
  const key = `${CONSENTS_KV_PREFIX}${consentId}`;
  const raw = consentId ? await env.LUMINARA_KV.get(key) : null;
  if (!raw) {
    return json({ error: 'invalid_request', error_description: 'This approval expired. Start the connection again.' }, 400);
  }
  let record: ConsentRecord;
  try {
    record = JSON.parse(raw) as ConsentRecord;
  } catch {
    return json({ error: 'invalid_request', error_description: 'This approval expired. Start the connection again.' }, 400);
  }

  // identify() refuses a cross-site cookie POST, so a page elsewhere cannot press Allow.
  const who = await identify(request, env);
  if (who.error || who.user?.id !== record.userId) {
    return json({ error: 'access_denied', error_description: 'Sign in as the account that opened this approval.' }, 403);
  }
  await env.LUMINARA_KV.delete(key);

  const redirect = new URL(record.redirectUri);
  if (record.state) redirect.searchParams.set('state', record.state);
  if (form?.get('decision') !== 'allow') {
    redirect.searchParams.set('error', 'access_denied');
    return Response.redirect(redirect.toString(), 303);
  }
  const code = randomId('oc', 16);
  const codeRecord: AuthCodeRecord = {
    accountId: record.accountId,
    userId: record.userId,
    plan: record.plan,
    redirectUri: record.redirectUri,
    codeChallenge: record.codeChallenge,
    scope: CONNECTOR_SCOPE,
    createdAt: Date.now(),
    clientId: record.clientId,
    clientName: record.clientName,
  };
  await env.LUMINARA_KV.put(`${CODES_KV_PREFIX}${code}`, JSON.stringify(codeRecord), { expirationTtl: 300 });
  redirect.searchParams.set('code', code);
  return Response.redirect(redirect.toString(), 303);
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
  // Absent scope requests everything; the plan cap below decides what is granted.
  const scope = url.searchParams.get('scope') || 'mcp:free mcp:research';

  if (!redirectUri || !codeChallenge || method !== 'S256') {
    return json({ error: 'invalid_request', error_description: 'redirect_uri and S256 code_challenge required' }, 400);
  }

  const clientId = url.searchParams.get('client_id') || '';
  if (clientId) return connectorAuthorize(request, env, { clientId, redirectUri, codeChallenge, state });

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

  // Research scope is granted only on Agency (apiAccess); Growth gets mcp:free.
  const scopes = scope.split(/\s+/).filter(Boolean);

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
    body = ((await request.json().catch(() => null)) || {}) as Record<string, string>;
  } else {
    try {
      const form = await request.formData();
      form.forEach((v, k) => {
        body[k] = String(v);
      });
    } catch {
      return json({ error: 'invalid_request', error_description: 'Body must be form-encoded or JSON.' }, 400);
    }
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
  if (record.clientId && record.clientId !== body.client_id) return json({ error: 'invalid_grant' }, 400);

  const challenge = await sha256Base64Url(verifier);
  if (challenge !== record.codeChallenge) return json({ error: 'invalid_grant', error_description: 'PKCE failed' }, 400);

  const accessToken = `mcp_${randomId('tok', 20)}`;
  const tokenRecord = {
    accountId: record.accountId,
    userId: record.userId,
    plan: record.plan,
    scope: record.scope,
    scopeEnforced: true,
    createdAt: Date.now(),
    clientName: record.clientName,
  };
  // Store under the SHA-256 hex of the token so the raw bearer value never lands in KV.
  await env.LUMINARA_KV.put(await tokenKvKey(accessToken), JSON.stringify(tokenRecord), {
    expirationTtl: TOKEN_TTL_SECONDS,
  });
  const connection: AgentConnection = {
    id: await sha256Hex(accessToken),
    name: record.clientName || 'MCP client',
    scope: record.scope,
    createdAt: tokenRecord.createdAt,
  };
  await env.LUMINARA_KV.put(await connectionKvKey(record.accountId, connection.id), '1', {
    expirationTtl: TOKEN_TTL_SECONDS,
    metadata: connection,
  });

  return json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: TOKEN_TTL_SECONDS,
    scope: record.scope,
  });
}

/** A live OAuth token as its owner sees it. `id` is the token's hash, so it cannot be used as one. */
export type AgentConnection = { id: string; name: string; scope: string; createdAt: number };

/** The account id is hashed so one account's prefix can never match another's keys. */
async function connectionKvKey(accountId: string, tokenHash = ''): Promise<string> {
  return `${CONNECTIONS_KV_PREFIX}${await sha256Hex(accountId)}:${tokenHash}`;
}

export async function listAgentConnections(env: Env, accountId: string): Promise<AgentConnection[]> {
  if (!env.LUMINARA_KV) return [];
  const listed = await env.LUMINARA_KV.list<AgentConnection>({ prefix: await connectionKvKey(accountId) });
  return listed.keys.flatMap((key) => (key.metadata ? [key.metadata] : [])).sort((a, b) => b.createdAt - a.createdAt);
}

/** False when the account has no such connection, so one account cannot revoke another's token. */
export async function revokeAgentConnection(env: Env, accountId: string, tokenHash: string): Promise<boolean> {
  if (!env.LUMINARA_KV || !/^[a-f0-9]{64}$/.test(tokenHash)) return false;
  const key = await connectionKvKey(accountId, tokenHash);
  if (!(await env.LUMINARA_KV.get(key))) return false;
  await env.LUMINARA_KV.delete(`${TOKENS_KV_PREFIX}${tokenHash}`);
  await env.LUMINARA_KV.delete(key);
  return true;
}

type StoredTokenRecord = {
  accountId: string;
  userId: string;
  plan: string;
  scope: string;
  /** Set on tokens minted after scope enforcement shipped; absent on legacy tokens. */
  scopeEnforced?: boolean;
  createdAt?: number;
  clientName?: string;
};

export type McpOAuthIdentity = { user: HostedIdentity; plan: string; scope: string; scopeEnforced: boolean };

/** Resolve Bearer mcp_* OAuth token to a HostedIdentity-like identity. */
export async function identifyMcpOAuthToken(
  env: Env,
  token: string,
): Promise<McpOAuthIdentity | null> {
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

function parseTokenRecord(raw: string): McpOAuthIdentity | null {
  try {
    const record = JSON.parse(raw) as StoredTokenRecord;
    if (!record?.accountId || !record?.scope) return null;
    const user: HostedIdentity = {
      id: record.userId || `oauth:${record.accountId}`,
      source: 'firebase',
      accountId: record.accountId,
      name: record.clientName || 'MCP OAuth',
    };
    return { user, plan: record.plan, scope: record.scope, scopeEnforced: record.scopeEnforced === true };
  } catch {
    return null;
  }
}
