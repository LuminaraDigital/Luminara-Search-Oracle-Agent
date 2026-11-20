import { describe, expect, it } from 'vitest';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import { handleMcpRequest } from '../worker/mcpServer';
import { withRecovery } from '../worker/mcpRecovery';
import { createSqliteD1 } from './helpers/sqliteD1';

function mockKv(store: Map<string, string>): KVNamespace {
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

type ToolCallBody = {
  result?: {
    isError?: boolean;
    content?: Array<{ text?: string }>;
    structuredContent?: Record<string, unknown>;
  };
};

async function callTool(name: string, args: Record<string, unknown>): Promise<ToolCallBody> {
  const store = new Map([['sub:acct_rec', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 86400_000 })]]);
  const env = {
    ASSETS: { fetch: async () => new Response('ok') },
    LUMINARA_KV: mockKv(store),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
  } as unknown as Env;
  const user: HostedIdentity = { id: 'u', source: 'firebase', accountId: 'acct_rec' };
  const res = await handleMcpRequest(
    new Request('https://luminarasuite.com/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }),
    env,
    user,
  );
  return (await res.json()) as ToolCallBody;
}

describe('MCP error recovery contract', () => {
  it('adds the retry verdict and next steps for a known code', () => {
    const out = withRecovery({ text: 'Context missing', structuredContent: { code: 'CONTEXT_REQUIRED' }, isError: true });
    expect(out.structuredContent?.retry).toBe('after_fix');
    expect(out.text).toContain('Context missing\nNext: Call get_project_context');
  });

  it('gives an uncoded error the TOOL_ERROR code and tells the agent not to retry', () => {
    const out = withRecovery({ text: 'Storage failed', isError: true });
    expect(out.structuredContent?.code).toBe('TOOL_ERROR');
    expect(out.structuredContent?.retry).toBe('never');
  });

  it('leaves a successful result untouched', () => {
    const ok = { text: 'fine', structuredContent: { a: 1 } };
    expect(withRecovery(ok)).toBe(ok);
  });

  it('a paid call without project context tells the agent which tool to call first', async () => {
    const body = await callTool('get_pagespeed_summary', { projectId: 'p1', url: 'https://example.com' });
    expect(body.result?.isError).toBe(true);
    expect(body.result?.structuredContent?.code).toBe('CONTEXT_REQUIRED');
    expect(body.result?.structuredContent?.retry).toBe('after_fix');
    expect(body.result?.content?.[0]?.text).toContain('Next: Call get_project_context');
  });
});

describe('get_guide', () => {
  it('lists guides when no topic is given', async () => {
    const body = await callTool('get_guide', {});
    expect(body.result?.isError).toBe(false);
    expect(body.result?.content?.[0]?.text).toContain('- luminara-audit:');
  });

  it('returns a guide by topic', async () => {
    const body = await callTool('get_guide', { topic: 'luminara-audit' });
    expect(body.result?.structuredContent?.topic).toBe('luminara-audit');
    expect(body.result?.content?.[0]?.text).toContain('# Luminara Audit');
  });

  it('an unknown topic points back to the guide list, not to project ids', async () => {
    const body = await callTool('get_guide', { topic: 'nope' });
    expect(body.result?.structuredContent?.code).toBe('NOT_FOUND');
    expect(body.result?.structuredContent?.nextSteps).toEqual([
      'Call get_guide with no topic to list the guides, then pass one of those topics.',
    ]);
  });
});
