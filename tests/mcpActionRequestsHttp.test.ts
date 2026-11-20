/**
 * HTTP approve/deny for mcp_action_requests (suite-10x M3).
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { consumeApprovedRequest, createActionRequest } from '../worker/mcpGovernance';
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
    list: async ({ prefix }: { prefix: string }) => ({
      keys: [...store.keys()].filter((name) => name.startsWith(prefix)).map((name) => ({ name })),
    }),
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

    const statusRes = await worker.fetch(req('/api/agent-habitat/status', { headers: owner() }), env, ctx);
    const { tokens } = (await statusRes.json()) as { tokens: Array<{ id: string }> };
    expect(tokens).toHaveLength(1);
    const revoked = await worker.fetch(
      req(`/api/agent-habitat/tokens/${tokens[0].id}`, { method: 'DELETE', headers: owner() }),
      env,
      ctx,
    );
    expect(revoked.status).toBe(200);
    const afterRevoke = await worker.fetch(
      req('/api/mcp', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      }),
      env,
      ctx,
    );
    expect(afterRevoke.status).toBe(401);
  });
});

describe('mcp-action-requests HTTP', () => {
  it('rejects unauthenticated list', async () => {
    const env = makeEnv();
    const res = await worker.fetch(req('/api/mcp-action-requests'), env, ctx);
    expect(res.status).toBe(401);
  });

  it('lists and approves own pending request; another account sees not found', async () => {
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
    expect(other.status).toBe(404);

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

  it('reads one request for the approval page, with the site and what approving does', async () => {
    const env = makeEnv();
    const made = await createProject(env, '88001', { domain: 'acme.io' });
    if (!made.ok) throw new Error(made.error);
    const created = await createActionRequest(env, {
      userId: '88001',
      toolName: 'browse_goal',
      projectId: made.project.id,
      args: { goal: 'Open pricing', token: 'lm_live_secretsecretsecret' },
    });
    const res = await worker.fetch(
      req(`/api/mcp-action-requests/${created.id}`, { headers: { 'x-telegram-init-data': signInitData(88001, 'Owner') } }),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { request: Record<string, unknown> };
    expect(body.request).toMatchObject({
      id: created.id,
      toolName: 'browse_goal',
      domain: 'acme.io',
      status: 'pending',
      expiresAt: created.expiresAt,
    });
    expect(String(body.request.consequence)).toContain('hosted browser');
    expect(String(body.request.args)).toContain('Open pricing');
    expect(String(body.request.args)).not.toContain('secretsecret');
    expect(body.request.argsTruncated).toBe(false);
    expect(body.request).not.toHaveProperty('user_id');
  });

  it('flags a request whose details are too long to show in full', async () => {
    const env = makeEnv();
    const created = await createActionRequest(env, {
      userId: '88001',
      toolName: 'browse_goal',
      args: { goal: `${'x'.repeat(5000)} then delete everything` },
    });
    const res = await worker.fetch(
      req(`/api/mcp-action-requests/${created.id}`, { headers: { 'x-telegram-init-data': signInitData(88001, 'Owner') } }),
      env,
      ctx,
    );
    const body = (await res.json()) as { request: { args: string; argsTruncated: boolean } };
    expect(body.request.argsTruncated).toBe(true);
    expect(body.request.args).toHaveLength(4000);

    const approve = await worker.fetch(
      req(`/api/mcp-action-requests/${created.id}/approve`, {
        method: 'POST',
        headers: { 'x-telegram-init-data': signInitData(88001, 'Owner') },
      }),
      env,
      ctx,
    );
    expect(approve.status).toBe(409);
    expect(((await approve.json()) as { code: string }).code).toBe('TOO_LONG_TO_REVIEW');
  });

  it("answers a missing request and another account's request identically", async () => {
    const env = makeEnv();
    const created = await createActionRequest(env, { userId: '88001', toolName: 'browse_close', args: { sessionId: 's1' } });
    const asOther = { headers: { 'x-telegram-init-data': signInitData(88002, 'Other') } };
    const foreign = await worker.fetch(req(`/api/mcp-action-requests/${created.id}`, asOther), env, ctx);
    const missing = await worker.fetch(req('/api/mcp-action-requests/00000000-0000-4000-8000-000000000000', asOther), env, ctx);
    expect(foreign.status).toBe(404);
    expect(await foreign.text()).toBe(await missing.text());
    const signedOut = await worker.fetch(req(`/api/mcp-action-requests/${created.id}`), env, ctx);
    expect(signedOut.status).toBe(401);
  });

  it('refuses to approve an expired request, and still lets it be denied', async () => {
    const env = makeEnv();
    const created = await createActionRequest(env, { userId: '88001', toolName: 'browse_close', args: { sessionId: 's1' } });
    await env.DB!.prepare('UPDATE mcp_action_requests SET expires_at = 1 WHERE id = ?').bind(created.id).run();
    const post = (decision: string) =>
      worker.fetch(
        req(`/api/mcp-action-requests/${created.id}/${decision}`, {
          method: 'POST',
          headers: { 'x-telegram-init-data': signInitData(88001, 'Owner') },
        }),
        env,
        ctx,
      );
    const approve = await post('approve');
    expect(approve.status).toBe(409);
    expect(((await approve.json()) as { code: string }).code).toBe('EXPIRED');
    expect((await post('deny')).status).toBe(200);
  });

  it('offers Deny only when part of the details was cut out before storing', async () => {
    const env = makeEnv();
    // Redaction replaces anything nested deeper than it walks with "[truncated]".
    let nested: Record<string, unknown> = { goal: 'delete everything' };
    for (let i = 0; i < 12; i++) nested = { inner: nested };
    const created = await createActionRequest(env, { userId: '88001', toolName: 'browse_goal', args: nested });
    const headers = { 'x-telegram-init-data': signInitData(88001, 'Owner') };
    const read = await worker.fetch(req(`/api/mcp-action-requests/${created.id}`, { headers }), env, ctx);
    const body = (await read.json()) as { request: { args: string; argsTruncated: boolean } };
    expect(body.request.args).toContain('[truncated]');
    expect(body.request.argsTruncated).toBe(true);
    const approve = await worker.fetch(
      req(`/api/mcp-action-requests/${created.id}/approve`, { method: 'POST', headers }),
      env,
      ctx,
    );
    expect(approve.status).toBe(409);
    expect(((await approve.json()) as { code: string }).code).toBe('TOO_LONG_TO_REVIEW');
  });

  it('an approval given on the page covers only the exact call that asked for it', async () => {
    const env = makeEnv();
    const reviewed = { domain: 'www.acme.io', token: 'A' };
    const created = await createActionRequest(env, { userId: '88001', toolName: 'prepare_cms_mcp_call', args: reviewed });
    const headers = { 'x-telegram-init-data': signInitData(88001, 'Owner') };

    // The owner reads the redacted copy; the hash that binds the approval is not sent to the browser.
    const read = await worker.fetch(req(`/api/mcp-action-requests/${created.id}`, { headers }), env, ctx);
    const readText = await read.text();
    expect(readText).toContain('[redacted]');
    expect(readText).not.toContain('args_hash');
    const list = await worker.fetch(req('/api/mcp-action-requests', { headers }), env, ctx);
    const listText = await list.text();
    expect(listText).toContain(created.id);
    expect(listText).not.toContain('args_hash');

    const approve = await worker.fetch(
      req(`/api/mcp-action-requests/${created.id}/approve`, { method: 'POST', headers }),
      env,
      ctx,
    );
    expect(approve.status).toBe(200);

    // Same redacted text, different token: the approval stays unspent.
    expect(await consumeApprovedRequest(env, '88001', 'prepare_cms_mcp_call', null, { domain: 'www.acme.io', token: 'B' })).toBe(false);
    // Same call with its keys in another order: spent once, then gone.
    expect(await consumeApprovedRequest(env, '88001', 'prepare_cms_mcp_call', null, { token: 'A', domain: 'www.acme.io' })).toBe(true);
    expect(await consumeApprovedRequest(env, '88001', 'prepare_cms_mcp_call', null, reviewed)).toBe(false);
  });

  it('never cuts the shown details in the middle of a character', async () => {
    const env = makeEnv();
    const created = await createActionRequest(env, { userId: '88001', toolName: 'browse_goal', args: { goal: '\u{1F600}'.repeat(2100) } });
    const read = await worker.fetch(
      req(`/api/mcp-action-requests/${created.id}`, { headers: { 'x-telegram-init-data': signInitData(88001, 'Owner') } }),
      env,
      ctx,
    );
    const { request } = (await read.json()) as { request: { args: string } };
    expect(request.args.length).toBeLessThanOrEqual(4000);
    expect(request.args.isWellFormed()).toBe(true);
  });
});
