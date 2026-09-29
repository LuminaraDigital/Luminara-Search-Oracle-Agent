/**
 * HTTP approve/deny for mcp_action_requests (suite-10x M3).
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { createActionRequest } from '../worker/mcpGovernance';
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
