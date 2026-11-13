/**
 * Track AE slice A: what a host (Grok, Claude Code, Antigravity, Cursor) sees when it connects.
 */
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { handleMcpRequest } from '../worker/mcpServer';
import { MCP_INSTRUCTIONS } from '../worker/mcpProtocol';
import type { HostedIdentity } from '../worker/userTypes';
import { createSqliteD1 } from './helpers/sqliteD1';

function makeEnv(): Env {
  const store = new Map<string, string>();
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => void store.set(k, v),
      delete: async (k: string) => void store.delete(k),
    } as unknown as KVNamespace,
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
  } as Env;
}

const user: HostedIdentity = {
  id: 'host-user',
  source: 'firebase',
  accountId: 'acct_host',
} as HostedIdentity;

function initialize(protocolVersion: unknown) {
  return handleMcpRequest(
    new Request('https://luminarasuite.com/api/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion } }),
    }),
    makeEnv(),
    user,
  );
}

describe('protocol version negotiation', () => {
  it('answers a 2025-06-18 client with 2025-06-18', async () => {
    const body = (await (await initialize('2025-06-18')).json()) as { result: { protocolVersion: string } };
    expect(body.result.protocolVersion).toBe('2025-06-18');
  });

  it('offers the newest supported version for an unknown one', async () => {
    const body = (await (await initialize('1900-01-01')).json()) as { result: { protocolVersion: string } };
    expect(body.result.protocolVersion).toBe('2025-06-18');
  });
});

describe('brand identity on initialize', () => {
  it('names Luminara with its mark, site and instructions', async () => {
    const body = (await (await initialize('2025-06-18')).json()) as {
      result: { serverInfo: Record<string, unknown>; instructions: string; capabilities: unknown };
    };
    expect(body.result.serverInfo).toEqual({
      name: 'luminara-mcp',
      title: 'Luminara Suite',
      version: '1.2.0',
      websiteUrl: 'https://luminarasuite.com',
      icons: [{ src: 'https://luminarasuite.com/favicon-192.png', mimeType: 'image/png', sizes: ['192x192'] }],
    });
    expect(body.result.instructions).toBe(MCP_INSTRUCTIONS);
    expect(body.result.instructions).toContain('Luminara');
    expect(body.result.capabilities).toEqual({ tools: {}, prompts: {} });
  });
});

describe('streamable HTTP details', () => {
  it('refuses a server stream with 405 and Allow: POST', async () => {
    const res = await handleMcpRequest(
      new Request('https://luminarasuite.com/api/mcp', { headers: { accept: 'text/event-stream' } }),
      makeEnv(),
      user,
    );
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('keeps the plain GET description, with the newest version', async () => {
    const res = await handleMcpRequest(new Request('https://luminarasuite.com/api/mcp'), makeEnv(), user);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: true, title: 'Luminara Suite', protocolVersion: '2025-06-18' });
  });

  it('answers a lone initialized notification with 202 and no body', async () => {
    const res = await handleMcpRequest(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      }),
      makeEnv(),
      user,
    );
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });
});

describe('401 for agents', () => {
  it('points an unauthenticated caller to the OAuth metadata in body and header', async () => {
    const res = await worker.fetch(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        body: '{}',
        headers: { 'cf-connecting-ip': '10.77.0.1' },
      }),
      makeEnv(),
      { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(401);
    const metadata = 'https://luminarasuite.com/.well-known/oauth-protected-resource/api/mcp';
    expect(res.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${metadata}"`);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ ok: false, code: 'AUTH_REQUIRED', resource_metadata: metadata });
    expect(String(body.error)).toContain('OAuth');
    expect(String(body.error)).not.toContain('Firebase');
  });
});
