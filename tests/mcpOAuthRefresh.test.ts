import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/index';
import { identifyMcpOAuthToken, listAgentConnections } from '../worker/mcpOAuth';
import { pruneMcpOAuthRefreshRows } from '../worker/mcpOAuthRefresh';
import { sha256Hex } from '../worker/workerUtils';
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
  const putTtls = new Map<string, number>();
  const LUMINARA_KV = {
    get: async (key: string, type?: unknown) => {
      const value = store.get(key) ?? null;
      return value && type === 'json' ? JSON.parse(value) : value;
    },
    put: async (key: string, value: string, options?: { metadata?: unknown; expirationTtl?: number }) => {
      store.set(key, value);
      if (options?.metadata) metadata.set(key, options.metadata);
      if (typeof options?.expirationTtl === 'number') putTtls.set(key, options.expirationTtl);
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
  return { env, store, putTtls };
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
    const extra = await register(env, ['authorization_code', 'client_credentials', 'refresh_token']);
    expect(extra.res.status).toBe(201);
    expect(extra.body.grant_types).toEqual(['authorization_code', 'refresh_token']);
    const codeOnly = await register(env, ['authorization_code']);
    expect(codeOnly.body.grant_types).toEqual(['authorization_code']);
  });

  it('omitted grant_types register both, and authorization_code alone does not issue a refresh token', async () => {
    const omitted = makeEnv();
    const withDefault = await connect(omitted.env);
    expect(withDefault.tokenRes.status).toBe(200);
    expect(withDefault.token.refresh_token?.startsWith('mcr_')).toBe(true);
    expect(withDefault.token.expires_in).toBe(60 * 60);
    expect(withDefault.tokenRes.headers.get('cache-control')).toBe('no-store');
    expect(withDefault.tokenRes.headers.get('pragma')).toBe('no-cache');

    const { env } = makeEnv();
    const issued = await connect(env, ['authorization_code']);
    expect(issued.token.access_token?.startsWith('mcp_')).toBe(true);
    expect(issued.token.refresh_token).toBeUndefined();
    expect(issued.token.expires_in).toBe(60 * 60 * 24 * 30);
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
    expect(rotated.headers.get('cache-control')).toBe('no-store');
    expect(rotated.headers.get('pragma')).toBe('no-cache');
    const row = await env.DB!.prepare(`SELECT successor_enc FROM mcp_oauth_refresh_family`).first<{ successor_enc: string }>();
    expect(JSON.stringify(row)).not.toContain(next.access_token ?? '');
    expect(JSON.stringify(row)).not.toContain(next.refresh_token ?? '');

    const replay = await refresh(env, refreshToken, issued.clientId);
    expect(replay.status).toBe(200);
    const same = (await replay.json()) as TokenBody;
    expect(same.access_token).toBe(next.access_token);
    expect(same.refresh_token).toBe(next.refresh_token);
  });

  it('revokes the family when a rotated refresh token is presented again', async () => {
    const { env } = makeEnv();
    const issued = await connect(env);
    const firstAccess = issued.token.access_token ?? '';
    const firstRefresh = issued.token.refresh_token ?? '';
    const rotated = (await (await refresh(env, firstRefresh, issued.clientId)).json()) as TokenBody;
    await env.DB!.prepare(`UPDATE mcp_oauth_refresh_family SET grace_until = 1`).run();
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

describe('refresh family atomicity', () => {
  it('returns the same successor when the same refresh token is used twice at once', async () => {
    const { env } = makeEnv();
    const issued = await connect(env);
    const [first, second] = await Promise.all([
      refresh(env, issued.token.refresh_token ?? '', issued.clientId),
      refresh(env, issued.token.refresh_token ?? '', issued.clientId),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const a = (await first.json()) as TokenBody;
    const b = (await second.json()) as TokenBody;
    expect(a.access_token).toBe(b.access_token);
    expect(a.refresh_token).toBe(b.refresh_token);
    expect(await identifyMcpOAuthToken(env, a.access_token ?? '')).toMatchObject({ scope: 'mcp:free' });
    const listed = await env.DB!.prepare(`SELECT COUNT(*) AS n FROM mcp_oauth_refresh_access`).first<{ n: number }>();
    expect(listed?.n).toBe(2);
  });

  it('replays the same tokens for 30 seconds, then a later reuse revokes the family', async () => {
    const { env } = makeEnv();
    const issued = await connect(env);
    const firstAccess = issued.token.access_token ?? '';
    const rotated = (await (await refresh(env, issued.token.refresh_token ?? '', issued.clientId)).json()) as TokenBody;
    const replay = await refresh(env, issued.token.refresh_token ?? '', issued.clientId);
    expect(replay.status).toBe(200);
    const again = (await replay.json()) as TokenBody;
    expect(again.access_token).toBe(rotated.access_token);
    expect(again.refresh_token).toBe(rotated.refresh_token);
    expect(await identifyMcpOAuthToken(env, firstAccess)).toMatchObject({ scope: 'mcp:free' });

    await env.DB!.prepare(`UPDATE mcp_oauth_refresh_family SET grace_until = 1`).run();
    const late = await refresh(env, issued.token.refresh_token ?? '', issued.clientId);
    expect(late.status).toBe(400);
    expect(late.headers.get('cache-control')).toBe('no-store');
    expect(((await late.json()) as TokenBody).error).toBe('invalid_grant');
    expect(await identifyMcpOAuthToken(env, firstAccess)).toBeNull();
    expect(await identifyMcpOAuthToken(env, rotated.access_token ?? '')).toBeNull();
  });

  it('refuses an access token whose family is missing, revoked, or does not list it', async () => {
    const missing = makeEnv();
    const dropped = await connect(missing.env);
    const droppedToken = dropped.token.access_token ?? '';
    await missing.env.DB!.prepare(`DELETE FROM mcp_oauth_refresh_family`).run();
    expect(await identifyMcpOAuthToken(missing.env, droppedToken)).toBeNull();

    const revoked = makeEnv();
    const cut = await connect(revoked.env);
    await revoked.env.DB!.prepare(`UPDATE mcp_oauth_refresh_family SET revoked = 1`).run();
    expect(await identifyMcpOAuthToken(revoked.env, cut.token.access_token ?? '')).toBeNull();

    const unlisted = makeEnv();
    const lone = await connect(unlisted.env);
    const loneToken = lone.token.access_token ?? '';
    await unlisted.env.DB!.prepare(`DELETE FROM mcp_oauth_refresh_access WHERE access_hash = ?`)
      .bind(await sha256Hex(loneToken))
      .run();
    expect(await identifyMcpOAuthToken(unlisted.env, loneToken)).toBeNull();
  });

  it('does not narrow scope when the plan read fails, and slides the client registration', async () => {
    const { env, putTtls } = makeEnv('agency');
    const registered = await register(env);
    const clientId = registered.body.client_id ?? '';
    const code = 'oc_plan_read_failure';
    const kv = env.LUMINARA_KV!;
    await kv.put(
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
    const originalGet = kv.get.bind(kv);
    kv.get = async (key: string, type?: unknown) => {
      if (key.startsWith('sub:')) throw new Error('kv down');
      return originalGet(key, type);
    };
    const failed = await refresh(env, issued.refresh_token ?? '', clientId);
    expect(failed.status).toBe(503);
    expect(((await failed.json()) as TokenBody).error).toBe('temporarily_unavailable');
    expect(failed.headers.get('pragma')).toBe('no-cache');
    putTtls.delete(`mcp_oauth_client:${clientId}`);
    kv.get = originalGet;
    const recovered = await refresh(env, issued.refresh_token ?? '', clientId);
    expect(recovered.status).toBe(200);
    expect(((await recovered.json()) as TokenBody).scope).toBe('mcp:free mcp:research');
    expect(putTtls.get(`mcp_oauth_client:${clientId}`)).toBe(60 * 60 * 24 * 90);
  });
});

describe('one connection per family', () => {
  it('keeps one row across refreshes and revokes the family after the access token is gone', async () => {
    const { env, store } = makeEnv();
    const issued = await connect(env);
    const rotated = (await (await refresh(env, issued.token.refresh_token ?? '', issued.clientId)).json()) as TokenBody;
    const listed = (await (await call(env, '/api/agent-connections', {}, 77001)).json()) as {
      connections: Array<{ id: string; familyId?: string; name: string }>;
    };
    expect(listed.connections).toHaveLength(1);
    expect(listed.connections[0]?.id.startsWith('fam_')).toBe(true);
    expect(listed.connections[0]?.familyId).toBe(listed.connections[0]?.id);
    for (const key of [...store.keys()]) {
      if (key.startsWith('mcp_oauth_token:')) store.delete(key);
    }
    const revoked = await call(env, `/api/agent-connections/${listed.connections[0]?.id}`, { method: 'DELETE' }, 77001);
    expect(revoked.status).toBe(200);
    const again = await refresh(env, rotated.refresh_token ?? '', issued.clientId);
    expect(again.status).toBe(400);
    expect(((await again.json()) as TokenBody).error).toBe('invalid_grant');
    const family = await env.DB!.prepare(`SELECT revoked FROM mcp_oauth_refresh_family`).first<{ revoked: number }>();
    expect(family?.revoked).toBe(1);
  });

  it('reads every KV list page', async () => {
    const pages = [
      {
        keys: [{ name: 'a', metadata: { id: 'fam_aa', name: 'A', scope: 'mcp:free', createdAt: 2, familyId: 'fam_aa' } }],
        list_complete: false,
        cursor: 'next',
      },
      {
        keys: [{ name: 'b', metadata: { id: 'fam_bb', name: 'B', scope: 'mcp:free', createdAt: 1, familyId: 'fam_bb' } }],
        list_complete: true,
        cursor: '',
      },
    ];
    let calls = 0;
    const env = {
      LUMINARA_KV: {
        list: async () => pages[calls++] ?? pages[1],
      },
    } as unknown as Env;
    const listed = await listAgentConnections(env, '77001');
    expect(calls).toBe(2);
    expect(listed.map((row) => row.name)).toEqual(['A', 'B']);
  });
});

describe('refresh table prune', () => {
  it('drops access rows older than an hour, retired rows older than 90 days, and expired grace ciphertext', async () => {
    const { env } = makeEnv();
    await connect(env);
    const now = Date.now();
    await env.DB!.prepare(`UPDATE mcp_oauth_refresh_access SET issued_at = ?`).bind(now - 2 * 60 * 60 * 1000).run();
    await env.DB!.prepare(
      `INSERT INTO mcp_oauth_refresh_access (access_hash, family_id, issued_at)
       SELECT 'recenthash', family_id, ? FROM mcp_oauth_refresh_family`,
    )
      .bind(now)
      .run();
    await env.DB!.prepare(
      `INSERT INTO mcp_oauth_refresh_retired (refresh_hash, family_id, retired_at)
       SELECT 'oldretired', family_id, ? FROM mcp_oauth_refresh_family`,
    )
      .bind(now - 100 * 24 * 60 * 60 * 1000)
      .run();
    await env.DB!.prepare(
      `INSERT INTO mcp_oauth_refresh_retired (refresh_hash, family_id, retired_at)
       SELECT 'newretired', family_id, ? FROM mcp_oauth_refresh_family`,
    )
      .bind(now)
      .run();
    await env.DB!.prepare(`UPDATE mcp_oauth_refresh_family SET successor_enc = 'cipher', grace_until = ?`)
      .bind(now - 1000)
      .run();
    const pruned = await pruneMcpOAuthRefreshRows(env, now);
    expect(pruned).toEqual({ access: 1, retired: 0, successors: 1, families: 0 });
    const access = await env.DB!.prepare(`SELECT access_hash FROM mcp_oauth_refresh_access`).all<{ access_hash: string }>();
    expect(access.results?.map((row) => row.access_hash).sort()).toEqual(['recenthash']);
    const retired = await env.DB!.prepare(`SELECT refresh_hash FROM mcp_oauth_refresh_retired ORDER BY refresh_hash`).all<{
      refresh_hash: string;
    }>();
    expect(retired.results?.map((row) => row.refresh_hash)).toEqual(['newretired', 'oldretired']);
    const family = await env.DB!.prepare(`SELECT successor_enc FROM mcp_oauth_refresh_family`).first<{ successor_enc: string | null }>();
    expect(family?.successor_enc).toBeNull();
  });

  it('refuses a refresh whose family has not rotated for 90 days, and the daily prune ends idle families', async () => {
    const { env } = makeEnv();
    const issued = await connect(env);
    const refreshToken = issued.token.refresh_token ?? '';
    const stale = Date.now() - 91 * 24 * 60 * 60 * 1000;
    await env.DB!.prepare(`UPDATE mcp_oauth_refresh_family SET updated_at = ?`).bind(stale).run();
    await env.DB!.prepare(
      `INSERT INTO mcp_oauth_refresh_retired (refresh_hash, family_id, retired_at)
       SELECT 'stolen', family_id, ? FROM mcp_oauth_refresh_family`,
    )
      .bind(stale)
      .run();
    const refused = await refresh(env, refreshToken, issued.clientId);
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as TokenBody).error).toBe('invalid_grant');
    const revoked = await env.DB!.prepare(`SELECT revoked FROM mcp_oauth_refresh_family`).first<{ revoked: number }>();
    expect(revoked?.revoked).toBe(1);
    expect(await identifyMcpOAuthToken(env, issued.token.access_token ?? '')).toBeNull();

    const { env: sweepEnv, store: sweepStore } = makeEnv();
    await connect(sweepEnv);
    const now = Date.now();
    await sweepEnv.DB!.prepare(`UPDATE mcp_oauth_refresh_family SET updated_at = ?`).bind(now - 91 * 24 * 60 * 60 * 1000).run();
    const familyId = (
      await sweepEnv.DB!.prepare(`SELECT family_id FROM mcp_oauth_refresh_family`).first<{ family_id: string }>()
    )?.family_id;
    await sweepEnv.DB!.prepare(`INSERT INTO mcp_oauth_refresh_retired (refresh_hash, family_id, retired_at) VALUES ('old', ?, ?)`)
      .bind(familyId, now - 10 * 24 * 60 * 60 * 1000)
      .run();
    const connectionKey = `mcp_oauth_connection:${await sha256Hex('77001')}:${familyId}`;
    sweepStore.set(connectionKey, '1');
    const pruned = await pruneMcpOAuthRefreshRows(sweepEnv, now);
    expect(sweepStore.has(connectionKey)).toBe(false);
    expect(pruned.families).toBe(1);
    const leftRetired = await sweepEnv.DB!.prepare(`SELECT COUNT(*) AS n FROM mcp_oauth_refresh_retired`).first<{ n: number }>();
    expect(leftRetired?.n).toBe(0);
    const leftFamily = await sweepEnv.DB!.prepare(`SELECT revoked FROM mcp_oauth_refresh_family`).first<{ revoked: number }>();
    expect(leftFamily?.revoked).toBe(1);
  });

  it('does not write D1 on an access check unless expired grace ciphertext is present', async () => {
    const { env } = makeEnv();
    const issued = await connect(env);
    const db = env.DB!;
    const prepare = db.prepare.bind(db);
    let updates = 0;
    db.prepare = (sql: string) => {
      if (/^\s*UPDATE/i.test(sql)) updates += 1;
      return prepare(sql);
    };
    expect(await identifyMcpOAuthToken(env, issued.token.access_token ?? '')).toMatchObject({ scope: 'mcp:free' });
    expect(updates).toBe(0);
    await prepare(`UPDATE mcp_oauth_refresh_family SET successor_enc = 'cipher', grace_until = ?`)
      .bind(Date.now() - 1000)
      .run();
    updates = 0;
    expect(await identifyMcpOAuthToken(env, issued.token.access_token ?? '')).toMatchObject({ scope: 'mcp:free' });
    expect(updates).toBe(1);
    const cleared = await prepare(`SELECT successor_enc FROM mcp_oauth_refresh_family`).first<{ successor_enc: string | null }>();
    expect(cleared?.successor_enc).toBeNull();
  });

  it('keeps the connection createdAt and records lastRefreshedAt', async () => {
    const { env, store } = makeEnv();
    const issued = await connect(env);
    for (const [key, value] of store) {
      if (!key.startsWith('mcp_oauth_connection:') || value === '1') continue;
      const parsed = JSON.parse(value) as { createdAt: number };
      parsed.createdAt = 111;
      store.set(key, JSON.stringify(parsed));
    }
    await refresh(env, issued.token.refresh_token ?? '', issued.clientId);
    const listed = (await (await call(env, '/api/agent-connections', {}, 77001)).json()) as {
      connections: Array<{ createdAt: number; lastRefreshedAt?: number }>;
    };
    expect(listed.connections).toHaveLength(1);
    expect(listed.connections[0]?.createdAt).toBe(111);
    expect(listed.connections[0]?.lastRefreshedAt).toBeGreaterThan(111);
  });

  it('refuses to seal a successor with the bot token when MCP_OAUTH_SECRET is empty', async () => {
    const { env } = makeEnv();
    const issued = await connect(env);
    (env as { MCP_OAUTH_SECRET?: string }).MCP_OAUTH_SECRET = '';
    const refused = await refresh(env, issued.token.refresh_token ?? '', issued.clientId);
    expect(refused.status).toBe(503);
    expect(((await refused.json()) as TokenBody).error).toBe('temporarily_unavailable');
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
