/**
 * HTTP approve/deny for mcp_action_requests (suite-10x M3).
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { createActionRequest } from '../worker/mcpGovernance';
import { createProject } from '../worker/projectService';
import { listActiveConstraints } from '../worker/scopedMemory';
import { createSqliteD1 } from './helpers/sqliteD1';

const botToken = '123456:MCP_ACTION_HTTP';

function signInitData(userId: number, firstName: string): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: firstName }),
  };
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const p = new URLSearchParams(fields);
  p.set('hash', hash);
  return p.toString();
}

function mockKv(store = new Map<string, string>()) {
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
  };
}

function makeEnv() {
  const store = new Map<string, string>([
    ['sub:88001', JSON.stringify({ plan: 'growth', expiresAt: Date.now() + 86400_000 })],
    ['sub:88002', JSON.stringify({ plan: 'growth', expiresAt: Date.now() + 86400_000 })],
  ]);
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: mockKv(store) as unknown as KVNamespace,
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    BOT_TOKEN: botToken,
  } as Env;
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function req(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('cf-connecting-ip', '203.0.113.50');
  return new Request(`https://luminarasuite.com${path}`, { ...init, headers });
}

describe('agent workspace through the worker', () => {
  const owner = () => ({ 'x-telegram-init-data': signInitData(88001, 'Owner'), 'content-type': 'application/json' });

  it('saves a denial reason as a rule scoped to the denied call', async () => {
    const env = makeEnv();
    const created = await createActionRequest(env, {
      userId: '88001',
      toolName: 'prepare_cms_mcp_call',
      projectId: null,
      args: { domain: 'www.acme.io' },
    });
    const res = await worker.fetch(
      req(`/api/mcp-action-requests/${created.id}/deny`, {
        method: 'POST',
        headers: owner(),
        body: JSON.stringify({ reason: 'Never touch the live homepage.' }),
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; compiledRule?: { ruleText: string } };
    expect(body.status).toBe('denied');
    expect(body.compiledRule?.ruleText).toContain('[Rule from prepare_cms_mcp_call]');
    const rules = await listActiveConstraints(env, '88001', { projectId: null, domain: 'acme.io' });
    expect(rules).toContain(body.compiledRule?.ruleText);
    const elsewhere = await listActiveConstraints(env, '88001', { projectId: null, domain: 'beta.io' });
    expect(elsewhere).toEqual([]);
  });

  it('scopes a denial to the denied call, not the page on screen', async () => {
    const env = makeEnv();
    const created = await createActionRequest(env, {
      userId: '88001',
      toolName: 'prepare_cms_mcp_call',
      projectId: null,
      args: { domain: 'client-b.io' },
    });
    await worker.fetch(
      req(`/api/mcp-action-requests/${created.id}/deny`, {
        method: 'POST',
        headers: owner(),
        body: JSON.stringify({ reason: 'Not on this site.', domain: 'client-a.io' }),
      }),
      env,
      ctx,
    );
    expect(await listActiveConstraints(env, '88001', { projectId: null, domain: 'client-a.io' })).toEqual([]);
    expect(await listActiveConstraints(env, '88001', { projectId: null, domain: 'client-b.io' })).toHaveLength(1);
  });

  it('denies with no rule when no reason is given', async () => {
    const env = makeEnv();
    const created = await createActionRequest(env, {
      userId: '88001',
      toolName: 'prepare_cms_mcp_call',
      projectId: null,
      args: {},
    });
    const res = await worker.fetch(
      req(`/api/mcp-action-requests/${created.id}/deny`, {
        method: 'POST',
        headers: { 'x-telegram-init-data': signInitData(88001, 'Owner') },
      }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; compiledRule?: unknown };
    expect(body.status).toBe('denied');
    expect(body.compiledRule).toBeUndefined();
  });

  it('mints a token over HTTP that works on /mcp only inside its project', async () => {
    const env = makeEnv();
    const acme = await createProject(env, '88001', { domain: 'acme.io', name: 'Acme' });
    const beta = await createProject(env, '88001', { domain: 'beta.io', name: 'Beta' });
    if (!acme.ok || !beta.ok) throw new Error('setup');

    const unsigned = await worker.fetch(req('/api/agent-habitat/tokens', { method: 'POST' }), env, ctx);
    expect(unsigned.status).toBe(401);

    const mintRes = await worker.fetch(
      req('/api/agent-habitat/tokens', {
        method: 'POST',
        headers: owner(),
        body: JSON.stringify({ domain: 'acme.io', maxRisk: 'read' }),
      }),
      env,
      ctx,
    );
    expect(mintRes.status).toBe(201);
    const { token } = (await mintRes.json()) as { token: string };

    const mcp = async (name: string, args: Record<string, unknown>) => {
      const res = await worker.fetch(
        req('/api/mcp', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
        }),
        env,
        ctx,
      );
      expect(res.status).toBe(200);
      return ((await res.json()) as { result: { isError?: boolean; structuredContent?: { code?: string } } }).result;
    };

    expect((await mcp('get_project_context', {})).isError).toBeFalsy();
    expect((await mcp('get_project_context', { projectId: beta.project.id })).structuredContent?.code).toBe(
      'HABITAT_PROJECT_SCOPE_VIOLATION',
    );

    const onAppRoute = await worker.fetch(
      req('/api/agent-habitat/status', { headers: { authorization: `Bearer ${token}` } }),
      env,
      ctx,
    );
    expect(onAppRoute.status).toBe(401);
  });
});

describe('mcp-action-requests HTTP', () => {
  it('rejects unauthenticated list', async () => {
    const env = makeEnv();
    const res = await worker.fetch(req('/api/mcp-action-requests'), env, ctx);
    expect(res.status).toBe(401);
  });

  it('lists and approves own pending request; forbids other account', async () => {
    const env = makeEnv();
    // Telegram billingId = user id string
    const created = await createActionRequest(env, {
      userId: '88001',
      toolName: 'browse_goal',
      projectId: null,
      args: { url: 'https://example.test' },
    });

    const list = await worker.fetch(
      req('/api/mcp-action-requests', {
        headers: { 'x-telegram-init-data': signInitData(88001, 'Owner') },
      }),
      env,
      ctx,
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as { ok: boolean; requests: Array<{ id: string; status: string }> };
    expect(listBody.ok).toBe(true);
    expect(listBody.requests.some((r) => r.id === created.id && r.status === 'pending')).toBe(true);

    const other = await worker.fetch(
      req(`/api/mcp-action-requests/${created.id}/approve`, {
        method: 'POST',
        headers: { 'x-telegram-init-data': signInitData(88002, 'Other') },
      }),
      env,
      ctx,
    );
    expect(other.status).toBe(403);

    const approve = await worker.fetch(
      req(`/api/mcp-action-requests/${created.id}/approve`, {
        method: 'POST',
        headers: { 'x-telegram-init-data': signInitData(88001, 'Owner') },
      }),
      env,
      ctx,
    );
    expect(approve.status).toBe(200);
    const approveBody = (await approve.json()) as { ok: boolean; status: string };
    expect(approveBody.ok).toBe(true);
    expect(approveBody.status).toBe('approved');

    const again = await worker.fetch(
      req(`/api/mcp-action-requests/${created.id}/approve`, {
        method: 'POST',
        headers: { 'x-telegram-init-data': signInitData(88001, 'Owner') },
      }),
      env,
      ctx,
    );
    expect(again.status).toBe(409);
  });

  it('denies pending request', async () => {
    const env = makeEnv();
    const created = await createActionRequest(env, {
      userId: '88001',
      toolName: 'browse_close',
      args: { sessionId: 's1' },
    });
    const deny = await worker.fetch(
      req(`/api/mcp-action-requests/${created.id}/deny`, {
        method: 'POST',
        headers: { 'x-telegram-init-data': signInitData(88001, 'Owner') },
      }),
      env,
      ctx,
    );
    expect(deny.status).toBe(200);
    const body = (await deny.json()) as { ok: boolean; status: string };
    expect(body.status).toBe('denied');
  });
});
