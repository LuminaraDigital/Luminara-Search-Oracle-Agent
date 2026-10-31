import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/index';
import { identifyMcpOAuthToken, isAllowedConnectorRedirectUri } from '../worker/mcpOAuth';
import { agentConnectTarget } from '../services/auth/agentConnect';
import { createSqliteD1 } from './helpers/sqliteD1';

const botToken = '123456:CONNECTOR_TEST';
const callback = 'https://grok.example/oauth/callback';
const verifier = 'connector-verifier-0123456789';
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function initData(userId: number): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Owner' }),
  };
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const p = new URLSearchParams(fields);
  p.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}

function makeEnv(plan = 'growth') {
  const store = new Map<string, string>([
    ['sub:77001', JSON.stringify({ plan, expiresAt: Date.now() + 86400_000 })],
  ]);
  const metadata = new Map<string, unknown>();
  const LUMINARA_KV = {
    get: async (key: string, type?: unknown) => {
      const value = store.get(key) ?? null;
      return value && type === 'json' ? JSON.parse(value) : value;
    },
    put: async (key: string, value: string, options?: { metadata?: unknown }) => {
      store.set(key, value);
      if (options?.metadata) metadata.set(key, options.metadata);
    },
    delete: async (key: string) => void store.delete(key),
    list: async ({ prefix }: { prefix: string }) => ({
      keys: [...store.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name, metadata: metadata.get(name) })),
      list_complete: true,
      cacheStatus: null,
    }),
  };
  const env = {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV,
    DB: createSqliteD1(),
    BOT_TOKEN: botToken,
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    MCP_OAUTH_SECRET: 'test-oauth-secret',
  } as unknown as Env;
  return { env, store };
}

let ipCounter = 0;
function call(env: Env, path: string, init: RequestInit = {}, userId?: number) {
  const headers = new Headers(init.headers);
  headers.set('cf-connecting-ip', `10.9.0.${(ipCounter++ % 250) + 1}`);
  if (userId) headers.set('x-telegram-init-data', initData(userId));
  return worker.fetch(new Request(`https://luminarasuite.com${path}`, { redirect: 'manual', ...init, headers }), env, ctx);
}

async function challenge(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function register(env: Env, redirectUris: string[] = [callback]) {
  return call(env, '/api/oauth/mcp/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Grok <b>', redirect_uris: redirectUris }),
  });
}

async function authorizePath(clientId: string, redirectUri = callback) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state: 'st1',
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
  });
  return `/api/oauth/mcp/authorize?${q}`;
}

function decide(env: Env, consent: string, decision: string, userId?: number) {
  return call(
    env,
    '/api/oauth/mcp/authorize',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ consent, decision }).toString(),
    },
    userId,
  );
}

async function openConsent(env: Env) {
  const { client_id: clientId } = (await (await register(env)).json()) as { client_id: string };
  const page = await call(env, await authorizePath(clientId), {}, 77001);
  const html = await page.text();
  return { clientId, page, html, consent: /name="consent" value="([^"]+)"/.exec(html)?.[1] ?? '' };
}

describe('agent connector discovery', () => {
  it('points an unauthenticated MCP call at protected resource metadata', async () => {
    const { env } = makeEnv();
    const res = await call(env, '/api/mcp', { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
    const header = res.headers.get('www-authenticate') ?? '';
    expect(header).toContain('resource_metadata="https://luminarasuite.com/.well-known/oauth-protected-resource/api/mcp"');
  });

  it('publishes resource and server metadata on the apex even in production', async () => {
    const { env } = makeEnv();
    const prod = { ...env, ENVIRONMENT: 'production' } as Env;
    const resource = await call(prod, '/.well-known/oauth-protected-resource/api/mcp');
    expect(resource.status).toBe(200);
    expect(await resource.json()).toMatchObject({
      resource: 'https://luminarasuite.com/api/mcp',
      authorization_servers: ['https://luminarasuite.com'],
    });
    const server = await call(prod, '/.well-known/oauth-authorization-server');
    expect(await server.json()).toMatchObject({
      issuer: 'https://luminarasuite.com',
      registration_endpoint: 'https://luminarasuite.com/api/oauth/mcp/register',
      token_endpoint_auth_methods_supported: ['none'],
    });
  });
});

describe('agent connector registration', () => {
  it('refuses a dangerous or plain http callback', async () => {
    const { env } = makeEnv();
    expect((await register(env, ['javascript:alert(1)'])).status).toBe(400);
    expect((await register(env, ['http://grok.example/cb'])).status).toBe(400);
    expect((await register(env, [])).status).toBe(400);
    expect(isAllowedConnectorRedirectUri('https://user:pw@grok.example/cb')).toBe(false);
    expect(isAllowedConnectorRedirectUri('https://grok.example/cb#x')).toBe(false);
  });

  it('never redirects to a callback the client did not register', async () => {
    const { env } = makeEnv();
    const { client_id: clientId } = (await (await register(env)).json()) as { client_id: string };
    const res = await call(env, await authorizePath(clientId, 'https://evil.example/cb'), {}, 77001);
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
  });

  it('does not let the legacy flow accept an unregistered https callback', async () => {
    const { env } = makeEnv();
    const path = (await authorizePath('x')).replace('client_id=x&', '');
    expect((await call(env, path, {}, 77001)).status).toBe(400);
  });
});

async function connect(env: Env) {
  const { clientId, consent } = await openConsent(env);
  const location = (await decide(env, consent, 'allow', 77001)).headers.get('location') ?? '';
  const res = await call(env, '/api/oauth/mcp/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: new URL(location).searchParams.get('code'),
      redirect_uri: callback,
      code_verifier: verifier,
      client_id: clientId,
    }),
  });
  return ((await res.json()) as { access_token: string }).access_token;
}

describe('connected agents', () => {
  type Listed = { connections: Array<{ id: string; name: string }> };

  it('lists a connection without exposing the token, and revoking ends it', async () => {
    const { env } = makeEnv();
    const token = await connect(env);
    const text = await (await call(env, '/api/agent-connections', {}, 77001)).text();
    expect(text).not.toContain(token);
    const { connections } = JSON.parse(text) as Listed;
    expect(connections.map((c) => c.name)).toEqual(['Grok <b>']);

    const revoked = await call(env, `/api/agent-connections/${connections[0]!.id}`, { method: 'DELETE' }, 77001);
    expect(revoked.status).toBe(200);
    expect(await identifyMcpOAuthToken(env, token)).toBeNull();
    const after = (await (await call(env, '/api/agent-connections', {}, 77001)).json()) as Listed;
    expect(after.connections).toEqual([]);
  });

  it('hides a connection from other accounts and refuses their revoke', async () => {
    const { env } = makeEnv();
    const token = await connect(env);
    const other = (await (await call(env, '/api/agent-connections', {}, 77002)).json()) as Listed;
    expect(other.connections).toEqual([]);
    const mine = (await (await call(env, '/api/agent-connections', {}, 77001)).json()) as Listed;
    const res = await call(env, `/api/agent-connections/${mine.connections[0]!.id}`, { method: 'DELETE' }, 77002);
    expect(res.status).toBe(404);
    expect(await identifyMcpOAuthToken(env, token)).not.toBeNull();
  });

  it('needs a signed-in owner', async () => {
    const { env } = makeEnv();
    expect((await call(env, '/api/agent-connections')).status).toBe(401);
  });
});

describe('browser MCP clients', () => {
  it('can preflight register and token from any origin', async () => {
    const { env } = makeEnv();
    for (const path of ['/api/oauth/mcp/register', '/api/oauth/mcp/token']) {
      const res = await call(env, path, { method: 'OPTIONS', headers: { origin: 'https://inspector.example' } });
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
    }
  });
});

describe('agent connector consent', () => {
  it('sends a signed-out owner to sign in with a same-origin return path', async () => {
    const { env } = makeEnv();
    const { client_id: clientId } = (await (await register(env)).json()) as { client_id: string };
    const path = await authorizePath(clientId);
    const res = await call(env, path);
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';
    expect(location.startsWith('/?agent_connect=')).toBe(true);
    expect(agentConnectTarget(location.slice(1))).toBe(path);
  });

  it('ignores a return path that leaves the approval route', () => {
    expect(agentConnectTarget('?agent_connect=https%3A%2F%2Fevil.example')).toBeNull();
    expect(agentConnectTarget('?agent_connect=%2F%2Fevil.example%2Fapi%2Foauth%2Fmcp%2Fauthorize%3Fa')).toBeNull();
    expect(agentConnectTarget('?agent_connect=%2Fapi%2Fadmin')).toBeNull();
  });

  it('escapes the self-chosen name and allows the form to reach the callback', async () => {
    const { env } = makeEnv();
    const { page, html } = await openConsent(env);
    expect(html).toContain('Grok &lt;b&gt;');
    expect(html).not.toContain('Grok <b>');
    expect(page.headers.get('content-security-policy')).toContain("form-action 'self' https://grok.example");
    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('lets Free and Starter open consent; the daily cap is the limit', async () => {
    for (const plan of ['free', 'starter']) {
      const { env, store } = makeEnv(plan);
      const { page, consent } = await openConsent(env);
      expect(page.status).toBe(200);
      expect(consent.startsWith('oconsent')).toBe(true);
      expect(store.has(`mcp_oauth_consent:${consent}`)).toBe(true);
    }
  });

  it('returns access_denied on Cancel', async () => {
    const { env, store } = makeEnv();
    const { consent } = await openConsent(env);
    const res = await decide(env, consent, 'deny', 77001);
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.searchParams.get('error')).toBe('access_denied');
    expect(location.searchParams.get('state')).toBe('st1');
    expect([...store.keys()].some((k) => k.startsWith('mcp_oauth_code:'))).toBe(false);
  });

  it('refuses an approval from another user or a signed-out caller, and keeps it usable', async () => {
    const { env, store } = makeEnv();
    const { consent } = await openConsent(env);
    expect((await decide(env, consent, 'allow', 77002)).status).toBe(403);
    expect((await decide(env, consent, 'allow')).status).toBe(403);
    expect(store.has(`mcp_oauth_consent:${consent}`)).toBe(true);
  });

  it('issues a free-scope token named for the client, once, only to that client', async () => {
    const { env } = makeEnv('agency');
    const { clientId, consent } = await openConsent(env);
    const allowed = await decide(env, consent, 'allow', 77001);
    expect(allowed.status).toBe(303);
    const code = new URL(allowed.headers.get('location') ?? '').searchParams.get('code') ?? '';
    expect((await decide(env, consent, 'allow', 77001)).status).toBe(400);

    const exchange = (id: string, c: string) =>
      call(env, '/api/oauth/mcp/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code', code: c, redirect_uri: callback, code_verifier: verifier, client_id: id }),
      });
    expect((await exchange('mcpc_other', code)).status).toBe(400);

    const { env: fresh } = makeEnv('agency');
    const second = await openConsent(fresh);
    const location = (await decide(fresh, second.consent, 'allow', 77001)).headers.get('location') ?? '';
    const freshCode = new URL(location).searchParams.get('code') ?? '';
    const res = await call(fresh, '/api/oauth/mcp/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code: freshCode, redirect_uri: callback, code_verifier: verifier, client_id: second.clientId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string; scope: string };
    expect(body.scope).toBe('mcp:free');
    const identity = await identifyMcpOAuthToken(fresh, body.access_token);
    expect(identity?.user.name).toBe('Grok <b>');
    expect(clientId).toMatch(/^mcpc/);
  });
});
