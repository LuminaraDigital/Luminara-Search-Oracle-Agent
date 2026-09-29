import { describe, expect, it } from 'vitest';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import {
  handleMcpRequest,
  markProjectContextLoaded,
  requireProjectContextBeforePaid,
} from '../worker/mcpServer';
import { createSqliteD1 } from './helpers/sqliteD1';

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

describe('APS paid context gate', () => {
  it('requireProjectContextBeforePaid blocks until markProjectContextLoaded', async () => {
    const store = new Map<string, string>();
    const env = { LUMINARA_KV: mockKv(store) } as Env;
    const blocked = await requireProjectContextBeforePaid(env, 'acct_a', 'proj_1');
    expect(blocked?.isError).toBe(true);
    expect(blocked?.structuredContent?.code).toBe('CONTEXT_REQUIRED');

    await markProjectContextLoaded(env, 'acct_a', 'proj_1');
    expect(await requireProjectContextBeforePaid(env, 'acct_a', 'proj_1')).toBeNull();
  });

  it('paid MCP call returns CONTEXT_REQUIRED without prior get_project_context', async () => {
    const store = new Map([
      ['sub:acct_ctx', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 86400_000 })],
    ]);
    const env = {
      ASSETS: { fetch: async () => new Response('ok') },
      LUMINARA_KV: mockKv(store),
      DB: createSqliteD1(),
      WEBAPP_URL: 'https://luminarasuite.com/',
    } as unknown as Env;
    const user: HostedIdentity = { id: 'u', source: 'firebase', accountId: 'acct_ctx' };
    const res = await handleMcpRequest(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: {
            name: 'get_pagespeed_summary',
            arguments: { projectId: 'p1', url: 'https://example.com' },
          },
        }),
      }),
      env,
      user,
    );
    const body = (await res.json()) as {
      result?: { isError?: boolean; structuredContent?: { code?: string } };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.structuredContent?.code).toBe('CONTEXT_REQUIRED');
  });
});
