import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/index';
import { identifyMcpOAuthToken } from '../worker/mcpOAuth';
import { createSqliteD1 } from './helpers/sqliteD1';

const botToken = '123456:REFRESH_TEST';
const callback = 'https://grok.example/oauth/callback';
const verifier = 'connector-verifier-0123456789-abcdefghijklm';
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

type TokenBody = {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
};

function initData(userId: number): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Owner' }),
  };
  const dcs = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const params = new URLSearchParams(fields);
  params.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return params.toString();
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
      keys: [...store.keys()]
        .filter((name) => name.startsWith(prefix))
        .map((name) => ({ name, metadata: metadata.get(name) })),
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
function call(env: Env, path: string, init: RequestInit = {}, userId?: number, ip?: string) {
  const headers = new Headers(init.headers);
  headers.set('cf-connecting-ip', ip ?? `10.8.0.${(ipCounter++ % 250) + 1}`);
  if (userId) headers.set('x-telegram-init-data', initData(userId));
  return worker.fetch(new Request(`https://luminarasuite.com${path}`, { redirect: 'manual', ...init, headers }), env, ctx);
}

async function challenge(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function leaks(store: Map<string, string>, secret: string): boolean {
  for (const [key, value] of store) {
    if (key.includes(secret) || value.includes(secret)) return true;
  }
  return false;
}

async function register(env: Env, grantTypes?: string[]) {
  const body: { client_name: string; redirect_uris: string[]; grant_types?: string[] } = {
    client_name: 'Grok <b>',
    redirect_uris: [callback],
  };
  if (grantTypes) body.grant_types = grantTypes;
  const res = await call(env, '/api/oauth/mcp/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, body: (await res.json()) as { client_id?: string; grant_types?: string[]; error?: string } };
}

async function connect(env: Env, grantTypes?: string[]) {
  const registered = await register(env, grantTypes);
  const clientId = registered.body.client_id ?? '';
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback,
    state: 'st1',
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
  });
  const page = await call(env, `/api/oauth/mcp/authorize?${q}`, {}, 77001);
  const html = await page.text();
  const consent = /name="consent" value="([^"]+)"/.exec(html)?.[1] ?? '';
  const allowed = await call(
    env,
    '/api/oauth/mcp/authorize',
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ consent, decision: 'allow' }).toString(),
    },
    77001,
  );
  const code = new URL(allowed.headers.get('location') ?? 'https://grok.example/oauth/callback').searchParams.get('code');
  const tokenRes = await call(env, '/api/oauth/mcp/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callback,
      code_verifier: verifier,
      client_id: clientId,
    }),
  });
  const token = (await tokenRes.json()) as TokenBody;
  return { clientId, tokenRes, token };
}

function refresh(env: Env, refreshToken: string, clientId: string, scope?: string) {
  const body: Record<string, string> = { grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId };
  if (scope !== undefined) body.scope = scope;
  return call(env, '/api/oauth/mcp/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('refresh token registration and metadata', () => {
  it('advertises refresh_token and keeps it when a client registers it', async () => {
    const { env } = makeEnv();
    const metadata = await call(env, '/.well-known/oauth-authorization-server');
    expect(await metadata.json()).toMatchObject({
      grant_types_supported: ['authorization_code', 'refresh_token'],
    });
    const registered = await register(env, ['authorization_code', 'refresh_token']);
    expect(registered.res.status).toBe(201);
    expect(registered.body.grant_types).toEqual(['authorization_code', 'refresh_token']);
    const refused = await register(env, ['authorization_code', 'client_credentials']);
    expect(refused.res.status).toBe(400);
    expect(refused.body.error).toBe('invalid_client_metadata');
    const codeOnly = await register(env, ['authorization_code']);
    expect(codeOnly.body.grant_types).toEqual(['authorization_code']);
  });

  it('omitted grant_types register both, and authorization_code alone does not issue a refresh token', async () => {
    const omitted = makeEnv();
    const withDefault = await connect(omitted.env);
    expect(withDefault.tokenRes.status).toBe(200);
    expect(withDefault.token.refresh_token?.startsWith('mcr_')).toBe(true);
    expect(withDefault.token.expires_in).toBe(60 * 60 * 24 * 30);

    const { env } = makeEnv();
    const issued = await connect(env, ['authorization_code']);
    expect(issued.token.access_token?.startsWith('mcp_')).toBe(true);
    expect(issued.token.refresh_token).toBeUndefined();
    const denied = await refresh(env, 'mcr_not-issued', issued.clientId);
    expect(denied.status).toBe(400);
    expect(((await denied.json()) as TokenBody).error).toBe('unauthorized_client');
  });
});

describe('refresh token rotation', () => {
  it('rotates, keeps the previous access token, and stores only hashes', async () => {
    const { env, store } = makeEnv();
    const issued = await connect(env);
    const access = issued.token.access_token ?? '';
    const refreshToken = issued.token.refresh_token ?? '';
    expect(leaks(store, access)).toBe(false);
    expect(leaks(store, refreshToken)).toBe(false);
    expect(await identifyMcpOAuthToken(env, refreshToken)).toBeNull();

    const rotated = await refresh(env, refreshToken, issued.clientId);
    expect(rotated.status).toBe(200);
    const next = (await rotated.json()) as TokenBody;
    expect(next.token_type).toBe('Bearer');
    expect(next.scope).toBe('mcp:free');
    expect(next.access_token?.startsWith('mcp_')).toBe(true);
    expect(next.refresh_token?.startsWith('mcr_')).toBe(true);
    expect(next.refresh_token).not.toBe(refreshToken);
    expect(leaks(store, next.refresh_token ?? '')).toBe(false);
    expect(await identifyMcpOAuthToken(env, access)).toMatchObject({ scope: 'mcp:free' });
    expect(await identifyMcpOAuthToken(env, next.access_token ?? '')).toMatchObject({ scope: 'mcp:free' });
    expect([...store.keys()].some((key) => key.startsWith('mcp_calls:'))).toBe(false);

    const spent = await refresh(env, refreshToken, issued.clientId);
    expect(spent.status).toBe(400);
    expect(((await spent.json()) as TokenBody).error).toBe('invalid_grant');
  });

  it('revokes the family when a rotated refresh token is presented again', async () => {
    const { env } = makeEnv();
    const issued = await connect(env);
    const firstAccess = issued.token.access_token ?? '';
    const firstRefresh = issued.token.refresh_token ?? '';
    const rotated = (await (await refresh(env, firstRefresh, issued.clientId)).json()) as TokenBody;
    const reused = await refresh(env, firstRefresh, issued.clientId);
    expect(reused.status).toBe(400);
    expect(((await reused.json()) as TokenBody).error).toBe('invalid_grant');
    expect(await identifyMcpOAuthToken(env, firstAccess)).toBeNull();
    expect(await identifyMcpOAuthToken(env, rotated.access_token ?? '')).toBeNull();
    const grandchild = await refresh(env, rotated.refresh_token ?? '', issued.clientId);
    expect(grandchild.status).toBe(400);
    expect(((await grandchild.json()) as TokenBody).error).toBe('invalid_grant');
  });

  it('refuses another client without burning the refresh token', async () => {
    const { env } = makeEnv();
    const issued = await connect(env);
    const other = await register(env);
    const misused = await refresh(env, issued.token.refresh_token ?? '', other.body.client_id ?? '');
    expect(misused.status).toBe(400);
    expect(((await misused.json()) as TokenBody).error).toBe('invalid_grant');
    const missing = await refresh(env, issued.token.refresh_token ?? '', '');
    expect(missing.status).toBe(401);
    expect(((await missing.json()) as TokenBody).error).toBe('invalid_client');
    const ok = await refresh(env, issued.token.refresh_token ?? '', issued.clientId);
    expect(ok.status).toBe(200);
    expect(await identifyMcpOAuthToken(env, issued.token.access_token ?? '')).toMatchObject({ scope: 'mcp:free' });
  });

  it('rejects a wider scope and still accepts the same refresh token', async () => {
    const { env } = makeEnv('agency');
    const issued = await connect(env);
    const wider = await refresh(env, issued.token.refresh_token ?? '', issued.clientId, 'mcp:free mcp:research');
    expect(wider.status).toBe(400);
    expect(((await wider.json()) as TokenBody).error).toBe('invalid_scope');
    const ok = await refresh(env, issued.token.refresh_token ?? '', issued.clientId);
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as TokenBody).scope).toBe('mcp:free');
  });

  it('drops research scope when the plan no longer includes it, and leaves the old access token', async () => {
    const { env, store } = makeEnv('agency');
    const registered = await register(env);
    const clientId = registered.body.client_id ?? '';
    const code = 'oc_research_refresh';
    store.set(
      `mcp_oauth_code:${code}`,
      JSON.stringify({
        accountId: '77001',
        userId: '77001',
        plan: 'agency',
        redirectUri: callback,
        codeChallenge: await challenge(verifier),
        scope: 'mcp:free mcp:research',
        createdAt: Date.now(),
        clientId,
        clientName: 'Agency agent',
      }),
    );
    const tokenRes = await call(env, '/api/oauth/mcp/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: callback,
        code_verifier: verifier,
        client_id: clientId,
      }),
    });
    const issued = (await tokenRes.json()) as TokenBody;
    expect(issued.scope).toBe('mcp:free mcp:research');
    store.delete('sub:77001');
    const rotated = await refresh(env, issued.refresh_token ?? '', clientId);
    expect(rotated.status).toBe(200);
    const next = (await rotated.json()) as TokenBody;
    expect(next.scope).toBe('mcp:free');
    expect(await identifyMcpOAuthToken(env, next.access_token ?? '')).toMatchObject({ scope: 'mcp:free', plan: 'free' });
    expect(await identifyMcpOAuthToken(env, issued.access_token ?? '')).toMatchObject({
      scope: 'mcp:free mcp:research',
      plan: 'agency',
    });
  });
});

describe('revoked accounts and revoke', () => {
  it('refuses refresh after the login is deleted and revokes the family', async () => {
    const { env, store } = makeEnv();
    const issued = await connect(env);
    store.set('session_revoked_user:77001', '1');
    const refused = await refresh(env, issued.token.refresh_token ?? '', issued.clientId);
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as TokenBody).error).toBe('invalid_grant');
    expect(await identifyMcpOAuthToken(env, issued.token.access_token ?? '')).toBeNull();
  });

  it('refuses refresh when the account is on the erase ledger', async () => {
    const { env } = makeEnv();
    const issued = await connect(env);
    await env.DB!.prepare(
      `INSERT INTO firestore_erase_ledger (account_id, user_ids_json, status, code, attempts, created_at, updated_at)
       VALUES (?, ?, 'done', '', 0, 1, 1)`,
    )
      .bind('77001', '["77001"]')
      .run();
    const refused = await refresh(env, issued.token.refresh_token ?? '', issued.clientId);
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as TokenBody).error).toBe('invalid_grant');
    expect(await identifyMcpOAuthToken(env, issued.token.access_token ?? '')).toBeNull();
  });

  it('revokes the family from a refresh token and from its access token', async () => {
    const { env } = makeEnv();
    const issued = await connect(env);
    const revoked = await call(env, '/api/oauth/mcp/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: issued.token.refresh_token, token_type_hint: 'refresh_token' }),
    });
    expect(revoked.status).toBe(200);
    expect(await identifyMcpOAuthToken(env, issued.token.access_token ?? '')).toBeNull();
    expect((await refresh(env, issued.token.refresh_token ?? '', issued.clientId)).status).toBe(400);

    const again = await connect(env);
    const byAccess = await call(env, '/api/oauth/mcp/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: again.token.access_token ?? '' }).toString(),
    });
    expect(byAccess.status).toBe(200);
    expect((await refresh(env, again.token.refresh_token ?? '', again.clientId)).status).toBe(400);
    expect(await identifyMcpOAuthToken(env, again.token.access_token ?? '')).toBeNull();
  });
});

describe('existing access tokens and the token rate limit', () => {
  it('still issues an access token with no client_id and no refresh token', async () => {
    const { env, store } = makeEnv();
    const code = 'oc_legacy_no_client';
    store.set(
      `mcp_oauth_code:${code}`,
      JSON.stringify({
        accountId: '77001',
        userId: '77001',
        plan: 'growth',
        redirectUri: 'http://127.0.0.1:8123/callback',
        codeChallenge: await challenge(verifier),
        scope: 'mcp:free',
        createdAt: Date.now(),
      }),
    );
    const res = await call(env, '/api/oauth/mcp/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: 'http://127.0.0.1:8123/callback',
        code_verifier: verifier,
      }),
    });
    const body = (await res.json()) as TokenBody;
    expect(res.status).toBe(200);
    expect(body.refresh_token).toBeUndefined();
    expect(await identifyMcpOAuthToken(env, body.access_token ?? '')).toMatchObject({ scope: 'mcp:free' });
    expect(leaks(store, body.access_token ?? '')).toBe(false);
  });

  it('counts refresh grants in the same per-IP token bucket', async () => {
    const { env, store } = makeEnv();
    const send = (ip: string) =>
      call(
        env,
        '/api/oauth/mcp/token',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'mcr_nope', client_id: 'mcpc_nope' }),
        },
        undefined,
        ip,
      );
    for (let i = 0; i < 30; i += 1) {
      expect((await send('203.0.113.44')).status).not.toBe(429);
    }
    const blocked = await send('203.0.113.44');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('X-RateLimit-Limit')).toBe('30');
    expect((await send('203.0.113.45')).status).toBe(401);
    expect([...store.keys()].some((key) => key.startsWith('rl:mcp_oauth_token:ip:'))).toBe(true);
    expect([...store.keys()].some((key) => key.startsWith('mcp_calls:'))).toBe(false);
  });
});
