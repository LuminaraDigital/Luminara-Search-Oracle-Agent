import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/index';
import { identifyMcpOAuthToken } from '../worker/mcpOAuth';
import { sha256Hex } from '../worker/workerUtils';
import { createSqliteD1 } from './helpers/sqliteD1';

const botToken = '123456:RESOURCE_TEST';
const callback = 'https://grok.example/oauth/callback';
const verifier = 'connector-verifier-0123456789-abcdefghijklm';
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const WWW = 'https://www.luminarasuite.com/api/mcp';
const APEX = 'https://luminarasuite.com/api/mcp';
const STAGING = 'https://staging.luminarasuite.com/api/mcp';
const THIRTY_DAYS = 60 * 60 * 24 * 30;

type TokenBody = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
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
  return { env, store, metadata };
}

let ipCounter = 0;
function call(env: Env, path: string, init: RequestInit = {}, userId?: number, origin = 'https://luminarasuite.com') {
  const headers = new Headers(init.headers);
  headers.set('cf-connecting-ip', `10.7.0.${(ipCounter++ % 250) + 1}`);
  if (userId) headers.set('x-telegram-init-data', initData(userId));
  return worker.fetch(new Request(`${origin}${path}`, { redirect: 'manual', ...init, headers }), env, ctx);
}

async function challenge(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function register(env: Env, grantTypes?: string[], origin?: string) {
  const body: { client_name: string; redirect_uris: string[]; grant_types?: string[] } = {
    client_name: 'ChatGPT',
    redirect_uris: [callback],
  };
  if (grantTypes) body.grant_types = grantTypes;
  const res = await call(
    env,
    '/api/oauth/mcp/register',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    undefined,
    origin,
  );
  return (await res.json()) as { client_id: string; grant_types: string[] };
}

async function authorizationCode(
  env: Env,
  clientId: string,
  resource?: string,
  origin = 'https://luminarasuite.com',
) {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callback,
    state: 'st1',
    code_challenge: await challenge(verifier),
    code_challenge_method: 'S256',
  });
  if (resource !== undefined) q.append('resource', resource);
  const page = await call(env, `/api/oauth/mcp/authorize?${q}`, {}, 77001, origin);
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
    origin,
  );
  const code = new URL(allowed.headers.get('location') || callback).searchParams.get('code');
  return { page, consent, code };
}

function tokenRequest(env: Env, body: Record<string, string>, origin?: string) {
  return call(
    env,
    '/api/oauth/mcp/token',
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    undefined,
    origin,
  );
}

function mcp(env: Env, token: string, origin?: string) {
  return call(
    env,
    '/api/mcp',
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    },
    undefined,
    origin,
  );
}

async function storedToken(store: Map<string, string>, access: string): Promise<Record<string, unknown> | null> {
  const raw = store.get(`mcp_oauth_token:${await sha256Hex(access)}`);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

describe('MCP OAuth resource indicator', () => {
  it('publishes the request origin as the protected resource and does not advertise iss', async () => {
    const { env } = makeEnv();
    const apex = await call(env, '/.well-known/oauth-protected-resource/api/mcp');
    expect(await apex.json()).toMatchObject({ resource: APEX });
    const www = await call(env, '/.well-known/oauth-protected-resource/api/mcp', {}, undefined, 'https://www.luminarasuite.com');
    expect(await www.json()).toMatchObject({ resource: WWW });
    const server = (await (await call(env, '/.well-known/oauth-authorization-server')).json()) as Record<string, unknown>;
    expect(server).not.toHaveProperty('authorization_response_iss_parameter_supported');
  });

  it('rejects a resource that is not this server and does not redirect', async () => {
    const { env } = makeEnv();
    const client = await register(env);
    const codeChallenge = await challenge(verifier);
    const authorize = (resource: string) => {
      const q = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: callback,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        resource,
      });
      return call(env, `/api/oauth/mcp/authorize?${q}`, {}, 77001);
    };
    for (const resource of [
      'https://evil.example/api/mcp',
      'https://www.luminarasuite.com/api/mcp#frag',
      'https://www.luminarasuite.com/mcp',
      'not-a-url',
    ]) {
      const res = await authorize(resource);
      expect(res.status, resource).toBe(400);
      expect(res.headers.get('location')).toBeNull();
      expect(await res.json()).toMatchObject({ error: 'invalid_target' });
    }
    const both = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: callback,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    both.append('resource', WWW);
    both.append('resource', APEX);
    const mixed = await call(env, `/api/oauth/mcp/authorize?${both}`, {}, 77001);
    expect(mixed.status).toBe(400);
    expect(((await mixed.json()) as TokenBody).error).toBe('invalid_target');
  });

  it('accepts the www resource on the apex host and keeps it through consent', async () => {
    const { env, store } = makeEnv();
    const client = await register(env, ['authorization_code', 'refresh_token']);
    const issued = await authorizationCode(env, client.client_id, 'HTTPS://WWW.LUMINARASUITE.COM/api/mcp');
    expect(issued.page.status).toBe(200);
    expect(issued.consent).not.toBe('');
    const tokenRes = await tokenRequest(env, {
      grant_type: 'authorization_code',
      code: issued.code ?? '',
      redirect_uri: callback,
      code_verifier: verifier,
      client_id: client.client_id,
      resource: WWW,
    });
    const token = (await tokenRes.json()) as TokenBody;
    expect(tokenRes.status).toBe(200);
    expect(token.expires_in).toBe(60 * 60);
    expect(token.refresh_token?.startsWith('mcr_')).toBe(true);
    expect(await storedToken(store, token.access_token ?? '')).toMatchObject({ resource: WWW });
    expect((await identifyMcpOAuthToken(env, token.access_token ?? ''))?.resource).toBe(WWW);
    const listed = (await (await call(env, '/api/agent-connections', {}, 77001)).json()) as {
      connections: Array<Record<string, unknown>>;
    };
    expect(listed.connections[0]).not.toHaveProperty('resource');
    const familyRows = [...store.entries()]
      .filter(([key]) => key.startsWith('mcp_oauth_connection:'))
      .map(([, value]) => JSON.parse(value) as { familyId?: string; resource?: string });
    expect(familyRows.some((row) => row.familyId && row.resource === WWW)).toBe(true);

    const again = await authorizationCode(env, client.client_id, WWW);
    const omitted = await tokenRequest(env, {
      grant_type: 'authorization_code',
      code: again.code ?? '',
      redirect_uri: callback,
      code_verifier: verifier,
      client_id: client.client_id,
    });
    const kept = (await omitted.json()) as TokenBody;
    expect(omitted.status).toBe(200);
    expect(await storedToken(store, kept.access_token ?? '')).toMatchObject({ resource: WWW });

    const mismatch = await authorizationCode(env, client.client_id, WWW);
    const rejected = await tokenRequest(env, {
      grant_type: 'authorization_code',
      code: mismatch.code ?? '',
      redirect_uri: callback,
      code_verifier: verifier,
      client_id: client.client_id,
      resource: APEX,
    });
    expect(rejected.status).toBe(400);
    expect(((await rejected.json()) as TokenBody).error).toBe('invalid_target');
  });

  it('binds a canonical resource sent only on the token request, and rejects any other', async () => {
    const { env, store } = makeEnv();
    const client = await register(env);
    const open = await authorizationCode(env, client.client_id);
    const bound = await tokenRequest(env, {
      grant_type: 'authorization_code',
      code: open.code ?? '',
      redirect_uri: callback,
      code_verifier: verifier,
      client_id: client.client_id,
      resource: WWW,
    });
    const token = (await bound.json()) as TokenBody;
    expect(bound.status).toBe(200);
    expect(token.refresh_token).toBeUndefined();
    expect(token.expires_in).toBe(THIRTY_DAYS);
    expect(await storedToken(store, token.access_token ?? '')).toMatchObject({ resource: WWW });
    expect((await mcp(env, token.access_token ?? '')).status).toBe(200);

    const evilCode = await authorizationCode(env, client.client_id);
    const evil = await tokenRequest(env, {
      grant_type: 'authorization_code',
      code: evilCode.code ?? '',
      redirect_uri: callback,
      code_verifier: verifier,
      client_id: client.client_id,
      resource: 'https://evil.example/api/mcp',
    });
    expect(evil.status).toBe(400);
    expect(((await evil.json()) as TokenBody).error).toBe('invalid_target');
  });

  it('keeps a client that omits resource on a 30 day token with no refresh', async () => {
    const { env, store } = makeEnv();
    const client = await register(env);
    expect(client.grant_types).toEqual(['authorization_code']);
    const open = await authorizationCode(env, client.client_id);
    const tokenRes = await tokenRequest(env, {
      grant_type: 'authorization_code',
      code: open.code ?? '',
      redirect_uri: callback,
      code_verifier: verifier,
      client_id: client.client_id,
    });
    const token = (await tokenRes.json()) as TokenBody;
    expect(tokenRes.status).toBe(200);
    expect(token.refresh_token).toBeUndefined();
    expect(token.expires_in).toBe(THIRTY_DAYS);
    const record = await storedToken(store, token.access_token ?? '');
    expect(record).not.toHaveProperty('resource');
    expect((await identifyMcpOAuthToken(env, token.access_token ?? ''))?.resource).toBeNull();
    expect((await mcp(env, token.access_token ?? '')).status).toBe(200);
    const stagingEnv = {
      ...env,
      ENVIRONMENT: 'staging',
      WEBAPP_URL: 'https://staging.luminarasuite.com/',
    } as Env;
    expect((await mcp(stagingEnv, token.access_token ?? '', 'https://staging.luminarasuite.com')).status).toBe(200);
  });

  it('copies the resource onto a refreshed access token and rejects a different one', async () => {
    const { env, store } = makeEnv();
    const client = await register(env, ['authorization_code', 'refresh_token']);
    const open = await authorizationCode(env, client.client_id, WWW);
    const token = (await (
      await tokenRequest(env, {
        grant_type: 'authorization_code',
        code: open.code ?? '',
        redirect_uri: callback,
        code_verifier: verifier,
        client_id: client.client_id,
        resource: WWW,
      })
    ).json()) as TokenBody;
    const refresh = (resource?: string) => {
      const body: Record<string, string> = {
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token ?? '',
        client_id: client.client_id,
      };
      if (resource !== undefined) body.resource = resource;
      return tokenRequest(env, body);
    };
    const wrong = await refresh(APEX);
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as TokenBody).error).toBe('invalid_target');
    const rotated = await refresh();
    const next = (await rotated.json()) as TokenBody;
    expect(rotated.status).toBe(200);
    expect(next.access_token).not.toBe(token.access_token);
    expect(await storedToken(store, next.access_token ?? '')).toMatchObject({ resource: WWW });
    expect((await identifyMcpOAuthToken(env, next.access_token ?? ''))?.resource).toBe(WWW);
    expect((await mcp(env, next.access_token ?? '')).status).toBe(200);
  });

  it('rejects an MCP call whose host is not the token resource', async () => {
    const { env } = makeEnv();
    const client = await register(env);
    const open = await authorizationCode(env, client.client_id, WWW);
    const token = (await (
      await tokenRequest(env, {
        grant_type: 'authorization_code',
        code: open.code ?? '',
        redirect_uri: callback,
        code_verifier: verifier,
        client_id: client.client_id,
        resource: WWW,
      })
    ).json()) as TokenBody;
    expect((await mcp(env, token.access_token ?? '')).status).toBe(200);
    const stagingEnv = {
      ...env,
      ENVIRONMENT: 'staging',
      WEBAPP_URL: 'https://staging.luminarasuite.com/',
    } as Env;
    const denied = await mcp(stagingEnv, token.access_token ?? '', 'https://staging.luminarasuite.com');
    expect(denied.status).toBe(401);
    const header = denied.headers.get('www-authenticate') ?? '';
    expect(header).toContain('error="invalid_token"');
    expect(header).toContain('resource_metadata="https://staging.luminarasuite.com/.well-known/oauth-protected-resource/api/mcp"');
  });

  it('accepts the staging resource on staging and rejects the production one', async () => {
    const { env } = makeEnv();
    const stagingEnv = {
      ...env,
      ENVIRONMENT: 'staging',
      WEBAPP_URL: 'https://staging.luminarasuite.com/',
    } as Env;
    const origin = 'https://staging.luminarasuite.com';
    const client = await register(stagingEnv, undefined, origin);
    const q = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: callback,
      code_challenge: await challenge(verifier),
      code_challenge_method: 'S256',
      resource: WWW,
    });
    const rejected = await call(stagingEnv, `/api/oauth/mcp/authorize?${q}`, {}, 77001, origin);
    expect(rejected.status).toBe(400);
    expect(((await rejected.json()) as TokenBody).error).toBe('invalid_target');
    const allowed = await authorizationCode(stagingEnv, client.client_id, STAGING, origin);
    expect(allowed.page.status).toBe(200);
    expect(allowed.code).toBeTruthy();
  });

  it('requires explicit consent and stores a resource on a localhost client that has no client_id', async () => {
    const { env, store } = makeEnv();
    const redirectUri = 'http://127.0.0.1/callback';
    const q = new URLSearchParams({
      redirect_uri: redirectUri,
      code_challenge: await challenge(verifier),
      code_challenge_method: 'S256',
      resource: APEX,
    });
    const page = await call(env, `/api/oauth/mcp/authorize?${q}`, {}, 77001);
    expect(page.status).toBe(200);
    expect(page.headers.get('location')).toBeNull();
    const html = await page.text();
    const consent = /name="consent" value="([^"]+)"/.exec(html)?.[1] ?? '';
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(consent).toBeTruthy();
    expect(csrf).toBeTruthy();
    const decided = await call(
      env,
      '/api/oauth/mcp/authorize',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ consent, csrf, decision: 'allow' }).toString(),
      },
      77001,
    );
    expect(decided.status).toBe(303);
    const code = new URL(decided.headers.get('location') ?? redirectUri).searchParams.get('code');
    const tokenRes = await tokenRequest(env, {
      grant_type: 'authorization_code',
      code: code ?? '',
      redirect_uri: redirectUri,
      code_verifier: verifier,
      resource: APEX,
    });
    const token = (await tokenRes.json()) as TokenBody;
    expect(tokenRes.status).toBe(200);
    expect(token.refresh_token).toBeUndefined();
    expect(token.expires_in).toBe(THIRTY_DAYS);
    expect(await storedToken(store, token.access_token ?? '')).toMatchObject({ resource: APEX });
    expect((await mcp(env, token.access_token ?? '')).status).toBe(200);
  });
});
