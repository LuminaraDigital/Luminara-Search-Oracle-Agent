import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { isApiAccessRoute, isMcpAccessRoute, requireMcpAccess } from '../worker/apiAccess';
import { planCapsFor } from '../worker/telegramBot';
import { entitlementsFor } from '../services/plans/planEntitlements';
import { createSqliteD1 } from './helpers/sqliteD1';
import { createApiKey } from '../worker/apiKeyService';
import { normalizeProjectDomain } from '../services/projects/projectUtils';

const botToken = '123456:APS_TEST_TOKEN';

function signInitData(fields: Record<string, string>, token = botToken): string {
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const p = new URLSearchParams(fields);
  p.set('hash', hash);
  return p.toString();
}

function mockKv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function makeEnv(store: Map<string, string>, overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: mockKv(store),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    REQUIRE_TG_AUTH: 'true',
    BOT_TOKEN: botToken,
    ...overrides,
  } as Env;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function tgHeaders(userId: number, ip: string) {
  const initData = signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Tester' }),
  });
  return {
    'content-type': 'application/json',
    'x-telegram-init-data': initData,
    'cf-connecting-ip': ip,
  };
}

describe('APS entitlements', () => {
  it('mcpAccess on growth/agency; apiAccess agency only; mcp route not agency-only', () => {
    expect(entitlementsFor('growth').mcpAccess).toBe(true);
    expect(entitlementsFor('starter').mcpAccess).toBe(false);
    expect(planCapsFor('growth').mcpAccess).toBe(true);
    expect(planCapsFor('agency').apiAccess).toBe(true);
    expect(isApiAccessRoute('/mcp')).toBe(false);
    expect(isMcpAccessRoute('/mcp')).toBe(true);
    expect(isApiAccessRoute('/oracle/chat')).toBe(true);
  });

  it('requireMcpAccess blocks free and allows growth', async () => {
    const env = makeEnv(new Map());
    const user = { id: '42', source: 'telegram' as const };
    expect((await requireMcpAccess(env, user))?.status).toBe(403);

    const growthEnv = makeEnv(
      new Map([['sub:42', JSON.stringify({ plan: 'growth', expiresAt: Date.now() + 86400_000 })]]),
    );
    expect(await requireMcpAccess(growthEnv, user)).toBeNull();
  });
});

describe('APS project utils', () => {
  it('normalizes domains', () => {
    expect(normalizeProjectDomain('https://www.Example.com/path')).toBe('example.com');
    expect(normalizeProjectDomain('Example.com')).toBe('example.com');
  });
});

describe('APS MCP + projects', () => {
  it('unsigned MCP returns 401; free signed-in returns 403; growth can whoami and create project', async () => {
    const store = new Map<string, string>();
    const env = makeEnv(store);

    const unsigned = await worker.fetch(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.20.0.1' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
      env,
      ctx,
    );
    expect(unsigned.status).toBe(401);

    const free = await worker.fetch(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: tgHeaders(101, '10.20.0.2'),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
      env,
      ctx,
    );
    expect(free.status).toBe(403);
    const freeBody = (await free.json()) as { code?: string };
    expect(freeBody.code).toBe('MCP_ACCESS_REQUIRED');

    store.set('sub:202', JSON.stringify({ plan: 'growth', expiresAt: Date.now() + 86400_000 }));
    const growthEnv = makeEnv(store);

    const listed = await worker.fetch(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: tgHeaders(202, '10.20.0.3'),
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      }),
      growthEnv,
      ctx,
    );
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      result?: { tools?: Array<{ name: string }> };
    };
    const names = (listBody.result?.tools || []).map((t) => t.name);
    expect(names).toContain('whoami');
    expect(names).toContain('create_project');
    expect(names).toContain('save_report');

    const created = await worker.fetch(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: tgHeaders(202, '10.20.0.4'),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'create_project',
            arguments: { domain: 'https://www.acme.test', name: 'Acme' },
          },
        }),
      }),
      growthEnv,
      ctx,
    );
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as {
      result?: { structuredContent?: { project?: { id: string; domain: string } }; isError?: boolean };
    };
    expect(createdBody.result?.isError).toBeFalsy();
    const projectId = createdBody.result?.structuredContent?.project?.id;
    expect(projectId).toMatch(/^proj_/);
    expect(createdBody.result?.structuredContent?.project?.domain).toBe('acme.test');

    const ctxUpdate = await worker.fetch(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: tgHeaders(202, '10.20.0.5'),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 4,
          method: 'tools/call',
          params: {
            name: 'update_project_context',
            arguments: {
              projectId,
              updates: [
                { section: 'business_overview', content: 'Acme sells widgets to SMBs.' },
                { addCompetitors: [{ domain: 'rival.test', notes: 'direct' }] },
              ],
            },
          },
        }),
      }),
      growthEnv,
      ctx,
    );
    expect(ctxUpdate.status).toBe(200);

    const ctxGet = await worker.fetch(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: tgHeaders(202, '10.20.0.6'),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 5,
          method: 'tools/call',
          params: { name: 'get_project_context', arguments: { projectId } },
        }),
      }),
      growthEnv,
      ctx,
    );
    const ctxBody = (await ctxGet.json()) as {
      result?: { structuredContent?: { context?: { missingSections: string[]; competitors: unknown[] } } };
    };
    expect(ctxBody.result?.structuredContent?.context?.competitors).toHaveLength(1);
    expect(ctxBody.result?.structuredContent?.context?.missingSections).toContain('current_goal');

    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Acme audit</title></head><body><h1>Acme</h1><p>ok</p></body></html>`;
    const saved = await worker.fetch(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: tgHeaders(202, '10.20.0.7'),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 6,
          method: 'tools/call',
          params: {
            name: 'save_report',
            arguments: {
              projectId,
              title: 'Acme audit, Sep 2026',
              summary: 'Verdict: site is thin. Top action: publish one money page.',
              html,
              skill: 'luminara-audit',
            },
          },
        }),
      }),
      growthEnv,
      ctx,
    );
    expect(saved.status).toBe(200);
    const savedBody = (await saved.json()) as {
      result?: { structuredContent?: { report?: { id: string; url: string } }; isError?: boolean };
    };
    expect(savedBody.result?.isError).toBeFalsy();
    expect(savedBody.result?.structuredContent?.report?.url).toContain('/reports/');

    const paid = await worker.fetch(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: tgHeaders(202, '10.20.0.8'),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 7,
          method: 'tools/call',
          params: {
            name: 'research_keywords',
            arguments: { projectId, seeds: ['widgets'] },
          },
        }),
      }),
      growthEnv,
      ctx,
    );
    const paidBody = (await paid.json()) as {
      result?: { isError?: boolean; structuredContent?: { code?: string } };
    };
    expect(paidBody.result?.isError).toBe(true);
    expect(paidBody.result?.structuredContent?.code).toBe('PAID_TOOL_FORBIDDEN');
  });

  it('a lapsed plan still lists and revokes its API keys but cannot mint one', async () => {
    const store = new Map<string, string>([
      ['sub:77101', JSON.stringify({ plan: 'growth', expiresAt: Date.now() + 86400_000 })],
    ]);
    const env = makeEnv(store);
    const call = (path: string, init: RequestInit, ip: string) =>
      worker.fetch(new Request(`https://luminarasuite.com${path}`, { ...init, headers: tgHeaders(77101, ip) }), env, ctx);

    const minted = await call('/api/api-keys', { method: 'POST', body: JSON.stringify({ name: 'Cursor' }) }, '10.20.2.1');
    expect(minted.status).toBe(200);
    const keyId = ((await minted.json()) as { meta: { id: string } }).meta.id;

    store.set('sub:77101', JSON.stringify({ plan: 'free', expiresAt: Date.now() + 86400_000 }));
    const listed = await call('/api/api-keys', { method: 'GET' }, '10.20.2.2');
    expect(listed.status).toBe(200);
    const list = (await listed.json()) as { mcpAccess: boolean; keys: Array<{ id: string }> };
    expect(list.mcpAccess).toBe(false);
    expect(list.keys.map((k) => k.id)).toEqual([keyId]);

    const refused = await call('/api/api-keys', { method: 'POST', body: JSON.stringify({ name: 'Again' }) }, '10.20.2.3');
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { code?: string }).code).toBe('MCP_ACCESS_REQUIRED');

    const revoked = await call(`/api/api-keys/${keyId}`, { method: 'DELETE' }, '10.20.2.4');
    expect(revoked.status).toBe(200);
    const after = (await (await call('/api/api-keys', { method: 'GET' }, '10.20.2.5')).json()) as { keys: unknown[] };
    expect(after.keys).toEqual([]);
  });

  it('answers a malformed percent-encoded project id with 400, not 500', async () => {
    const env = makeEnv(new Map());
    const res = await worker.fetch(
      new Request('https://luminarasuite.com/api/projects/%E0%A4%A', { headers: tgHeaders(77102, '10.20.3.1') }),
      env,
      ctx,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'The URL has invalid percent-encoding.', code: 'BAD_ENCODING' });
  });

  it('API key authenticates MCP for growth account', async () => {
    const store = new Map<string, string>([
      ['sub:acct_g', JSON.stringify({ plan: 'growth', expiresAt: Date.now() + 86400_000 })],
    ]);
    const env = makeEnv(store);
    const user = { id: 'apk-owner', source: 'firebase' as const, accountId: 'acct_g' };
    const created = await createApiKey(env, user, 'test');
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const res = await worker.fetch(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${created.key}`,
          'cf-connecting-ip': '10.20.1.1',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whoami', arguments: {} } }),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { structuredContent?: { accountId?: string; mcpAccess?: boolean } };
    };
    expect(body.result?.structuredContent?.accountId).toBe('acct_g');
    expect(body.result?.structuredContent?.mcpAccess).toBe(true);
  });
});
