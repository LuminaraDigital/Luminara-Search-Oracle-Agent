import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { handleMcpRequest, listMcpToolCatalogue } from '../worker/mcpServer';
import { TOOL_GOVERNANCE } from '../worker/mcpGovernance';
import { enforceMcpOauthIpLimit, MCP_ACCOUNT_BURST_PER_MIN, MCP_CLIENT_BURST_PER_MIN, MCP_HOSTED_PAID_DAILY, spendMcpDailyCall } from '../worker/mcpLimits';
import { pageList } from '../worker/mcpToolMeta';
import { MCP_PUBLIC_URL } from '../services/mcp/publicServer';
import type { HostedIdentity, McpCredential } from '../worker/userTypes';
import { createSqliteD1 } from './helpers/sqliteD1';

function mockKv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string, type?: string) => {
      const value = store.get(key);
      if (value === undefined) return null;
      return type === 'json' ? JSON.parse(value) : value;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function makeEnv(store = new Map<string, string>(), overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: mockKv(store),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://www.luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://www.luminarasuite.com',
    REQUIRE_TG_AUTH: 'true',
    ...overrides,
  } as Env;
}

const execCtx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function cred(clientId: string): McpCredential {
  return { kind: 'oauth', id: null, scopes: ['mcp:free'], clientId };
}

function user(id: string): HostedIdentity {
  return { id, source: 'telegram' };
}

function call(name = 'whoami') {
  return new Request('https://www.luminarasuite.com/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } }),
  });
}

type Rpc = {
  result?: {
    isError?: boolean;
    structuredContent?: { code?: string; callsUsedToday?: number; callsRemainingToday?: number | null; plan?: string };
    _meta?: { rateLimit?: { limit: number; remaining: number | null; reset: number } };
  };
  error?: { code?: number; message?: string; data?: { code?: string; resetAt?: number; remaining?: number; limit?: number } };
};

describe('MCP daily cap is per account', () => {
  it('a second credential on the same account keeps the count and a different account does not', async () => {
    const env = makeEnv();
    const first = (await (await handleMcpRequest(call(), env, user('acct-1'), cred('client-a'))).json()) as Rpc;
    expect(first.result?.structuredContent?.callsUsedToday).toBe(1);
    expect(first.result?.structuredContent?.callsRemainingToday).toBe(99);
    expect(first.result?.structuredContent?.plan).toBe('free');
    expect(first.result?._meta?.rateLimit?.limit).toBe(100);
    expect(first.result?._meta?.rateLimit?.remaining).toBe(99);
    expect(first.result?._meta?.rateLimit?.reset).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const second = (await (await handleMcpRequest(call(), env, user('acct-1'), cred('client-b'))).json()) as Rpc;
    expect(second.result?.structuredContent?.callsUsedToday).toBe(2);
    expect(second.result?.structuredContent?.callsRemainingToday).toBe(98);

    const other = (await (await handleMcpRequest(call(), env, user('acct-2'), cred('client-b'))).json()) as Rpc;
    expect(other.result?.structuredContent?.callsUsedToday).toBe(1);
  });

  it('returns a JSON-RPC error with reset time once the account is at 100', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const store = new Map<string, string>([[`mcp_calls:acct-1:${day}`, '100']]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await handleMcpRequest(call(), makeEnv(store), user('acct-1'), cred('fresh-token'));
    const body = (await res.json()) as Rpc;
    expect(body.result).toBeUndefined();
    expect(body.error?.code).toBe(-32000);
    expect(body.error?.data?.code).toBe('MCP_DAILY_LIMIT');
    expect(body.error?.data?.remaining).toBe(0);
    expect(body.error?.data?.resetAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(body.error?.message).toContain('Resets at');
    expect(res.headers.get('X-RateLimit-Limit')).toBe('100');
    expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(res.headers.get('X-RateLimit-Reset')).toBe(String(body.error?.data?.resetAt));
    const logged = warn.mock.calls.map((args) => String(args[0])).find((line) => line.includes('mcp_abuse'));
    expect(logged).toContain('"kind":"MCP_DAILY_LIMIT"');
    expect(logged).not.toContain('mcp_tok');
    expect(logged).not.toContain('Bearer');
    expect(logged).not.toContain('@');
    warn.mockRestore();
  });

  it('rejects the call when the daily counter cannot be stored', async () => {
    const env = makeEnv();
    env.LUMINARA_KV!.put = async () => {
      throw new Error('KV put rejected');
    };
    const spent = await spendMcpDailyCall(env, 'acct-kv', 100);
    expect(spent.ok).toBe(false);
    if (!spent.ok) {
      expect(spent.reason).toBe('store');
      expect(spent.usage.used).toBe(0);
      expect(spent.error).toContain('quota store unavailable');
    }
  });
});

describe('MCP burst limits', () => {
  it('stops the 31st tool call for one account and leaves another account alone', async () => {
    const env = makeEnv();
    for (let i = 0; i < MCP_ACCOUNT_BURST_PER_MIN; i += 1) {
      const body = (await (await handleMcpRequest(call(), env, user('burst-a'), cred('only-a'))).json()) as Rpc;
      expect(body.error?.data?.code).toBeUndefined();
    }
    const blocked = (await (await handleMcpRequest(call(), env, user('burst-a'), cred('only-a'))).json()) as Rpc;
    expect(blocked.error?.data?.code).toBe('MCP_ACCOUNT_BURST');
    expect(blocked.error?.data?.limit).toBe(30);
    expect(typeof blocked.error?.data?.resetAt).toBe('number');

    const other = (await (await handleMcpRequest(call(), env, user('burst-b'), cred('only-b'))).json()) as Rpc;
    expect(other.result?.structuredContent?.plan).toBe('free');
  });

  it('stops a client_id shared by two accounts after 30 tool calls', async () => {
    const env = makeEnv();
    const shared = 'client-shared';
    for (let i = 0; i < 20; i += 1) {
      const body = (await (await handleMcpRequest(call(), env, user('left'), cred(shared))).json()) as Rpc;
      expect(body.error).toBeUndefined();
    }
    for (let i = 0; i < 10; i += 1) {
      const body = (await (await handleMcpRequest(call(), env, user('right'), cred(shared))).json()) as Rpc;
      expect(body.error).toBeUndefined();
    }
    const blocked = (await (await handleMcpRequest(call(), env, user('right'), cred(shared))).json()) as Rpc;
    expect(blocked.error?.data?.code).toBe('MCP_CLIENT_BURST');
    expect(blocked.error?.data?.limit).toBe(MCP_CLIENT_BURST_PER_MIN);

    let more = 0;
    for (let i = 0; i < 25; i += 1) {
      const body = (await (await handleMcpRequest(call(), env, user('right'), cred('other-client'))).json()) as Rpc;
      if (body.error?.data?.code === 'MCP_ACCOUNT_BURST') break;
      expect(body.error).toBeUndefined();
      more += 1;
    }
    expect(more).toBe(20);
  });
});

describe('hosted paid MCP quota', () => {
  it('blocks the 201st hosted paid call and does not count BYOK', async () => {
    const day = new Date().toISOString().slice(0, 10);
    const store = new Map<string, string>([
      ['sub:agency-1', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 86_400_000 })],
      [`mcp_paid:agency-1:${day}`, String(MCP_HOSTED_PAID_DAILY)],
      ['mcp:context_loaded:agency-1:proj-1', '1'],
    ]);
    const env = makeEnv(store);
    const research: McpCredential = { kind: 'oauth', id: null, scopes: ['mcp:free', 'mcp:research'], clientId: 'paid-client' };
    const blockedReq = new Request('https://www.luminarasuite.com/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'research_keywords', arguments: { projectId: 'proj-1', seeds: ['aeo'] } },
      }),
    });
    const blocked = (await (await handleMcpRequest(blockedReq, env, user('agency-1'), research)).json()) as Rpc;
    expect(blocked.error?.data?.code).toBe('MCP_PAID_DAILY_LIMIT');
    expect(blocked.error?.data?.limit).toBe(200);

    const byok = new Request('https://www.luminarasuite.com/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-provider-key': 'login:secret' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'research_keywords', arguments: { projectId: 'missing', seeds: ['aeo'] } },
      }),
    });
    const skipped = (await (await handleMcpRequest(byok, env, user('agency-1'), research)).json()) as Rpc;
    expect(skipped.error?.data?.code).not.toBe('MCP_PAID_DAILY_LIMIT');
    expect(store.get(`mcp_paid:agency-1:${day}`)).toBe('200');
  });

  it('does not spend a hosted paid call when project context is missing', async () => {
    const store = new Map<string, string>([
      ['sub:agency-2', JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 86_400_000 })],
    ]);
    const env = makeEnv(store);
    const research: McpCredential = { kind: 'oauth', id: null, scopes: ['mcp:free', 'mcp:research'], clientId: 'paid-client-2' };
    const res = await handleMcpRequest(call('research_keywords'), env, user('agency-2'), research);
    const body = (await res.json()) as Rpc;
    expect(body.result?.isError).toBe(true);
    expect(body.result?.structuredContent?.code).toBe('CONTEXT_REQUIRED');
    expect([...store.keys()].some((key) => key.startsWith('mcp_paid:'))).toBe(false);
  });
});

describe('revoked MCP tokens', () => {
  it('returns invalid_token instead of a Firebase error', async () => {
    const env = makeEnv(new Map(), { FIREBASE_PROJECT_ID: 'luminara-test' });
    const res = await worker.fetch(
      new Request('https://www.luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: {
          authorization: 'Bearer mcp_tok_revokedexample',
          'content-type': 'application/json',
          'cf-connecting-ip': '203.0.113.50',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'whoami', arguments: {} } }),
      }),
      env,
      execCtx,
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: string; code?: string };
    expect(body).toEqual({ ok: false, error: 'token revoked or expired, reconnect', code: 'invalid_token' });
    expect(res.headers.get('WWW-Authenticate')).toContain('error="invalid_token"');
    expect(res.headers.get('WWW-Authenticate')).toContain('/.well-known/oauth-protected-resource/api/mcp');
    expect(JSON.stringify(body)).not.toContain('Firebase');
  });
});

describe('OAuth register and token IP limits', () => {
  it('stops the 11th register from one IP', async () => {
    const env = makeEnv();
    const send = (ip: string) =>
      worker.fetch(
        new Request('https://www.luminarasuite.com/api/oauth/mcp/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
          body: JSON.stringify({ client_name: 'Agent', redirect_uris: ['http://127.0.0.1:9/callback'] }),
        }),
        env,
        execCtx,
      );
    for (let i = 0; i < 10; i += 1) {
      expect((await send('203.0.113.20')).status).toBe(201);
    }
    const blocked = await send('203.0.113.20');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('X-RateLimit-Limit')).toBe('10');
    expect((await send('203.0.113.21')).status).toBe(201);
  });

  it('stops the 31st token exchange from one IP on the token route', async () => {
    const env = makeEnv();
    for (let i = 0; i < 30; i += 1) {
      const result = await enforceMcpOauthIpLimit(env, 'mcp_oauth_token', '203.0.113.30', 30);
      expect(result.ok).toBe(true);
    }
    const blocked = await worker.fetch(
      new Request('https://www.luminarasuite.com/api/oauth/mcp/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.30' },
        body: JSON.stringify({ grant_type: 'authorization_code' }),
      }),
      env,
      execCtx,
    );
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('X-RateLimit-Limit')).toBe('30');
    const other = await worker.fetch(
      new Request('https://www.luminarasuite.com/api/oauth/mcp/token', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.31' },
        body: JSON.stringify({ grant_type: 'authorization_code' }),
      }),
      env,
      execCtx,
    );
    expect(other.status).not.toBe(429);
  });

  it('does not admit a register when the rate-limit write fails', async () => {
    const env = makeEnv();
    env.LUMINARA_KV!.put = async () => {
      throw new Error('KV put rejected');
    };
    const blocked = await enforceMcpOauthIpLimit(env, 'mcp_oauth_register', '203.0.113.77', 10);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.response.status).toBe(429);
      expect(((await blocked.response.json()) as { code?: string }).code).toBe('RATE_STORE_UNAVAILABLE');
      expect(blocked.response.headers.get('Retry-After')).toBe('1');
    }
  });
});

describe('MCP tool catalogue', () => {
  it('pages list results at 50', () => {
    const items = Array.from({ length: 60 }, (_, i) => i);
    const first = pageList(items, {});
    expect(first.items).toEqual(items.slice(0, 50));
    expect(first.nextCursor).toBe('50');
    expect(first.truncated).toBe(true);
    const second = pageList(items, { cursor: '50' });
    expect(second.items).toEqual(items.slice(50));
    expect(second.nextCursor).toBeNull();
  });

  it('annotations follow governance and every tool has a real title', () => {
    const tools = listMcpToolCatalogue();
    expect(tools).toHaveLength(33);
    expect(Object.keys(TOOL_GOVERNANCE).sort()).toEqual(tools.map((tool) => tool.name).sort());
    for (const tool of tools) {
      const risk = TOOL_GOVERNANCE[tool.name].risk;
      expect(tool.annotations.readOnlyHint).toBe(risk === 'read');
      expect(tool.annotations.destructiveHint).toBe(risk === 'destructive');
      expect(tool.annotations.title.length).toBeGreaterThan(3);
      expect(tool.description.length).toBeGreaterThan(40);
    }
  });

  it('the committed catalog matches the live tool list', () => {
    const committed = JSON.parse(readFileSync('connectors/mcp/tool-catalog.json', 'utf8')) as unknown;
    expect(committed).toEqual(listMcpToolCatalogue());
  });

  it('listing pack names real tools and the public server', () => {
    const listing = JSON.parse(readFileSync('connectors/mcp/listing/listing.json', 'utf8')) as {
      name: string;
      remoteUrl: string;
      publisher: { name: string; abn: string };
      examplePrompts: Array<{ tool: string }>;
    };
    expect(listing.name).toBe('Luminara Suite');
    expect(listing.remoteUrl).toBe(MCP_PUBLIC_URL);
    expect(listing.publisher).toEqual({ name: 'LUMINARA DIGITAL PTY LTD', abn: '90 693 125 281' });
    const names = new Set(listMcpToolCatalogue().map((tool) => tool.name));
    expect(listing.examplePrompts.map((row) => row.tool)).toEqual([
      'whoami',
      'list_projects',
      'get_project_context',
      'list_reports',
      'save_report',
    ]);
    for (const tool of listing.examplePrompts) expect(names.has(tool.tool)).toBe(true);
  });

  it('connector manifest uses the public server URL', () => {
    const server = JSON.parse(readFileSync('connectors/mcp/server.json', 'utf8')) as { remotes: Array<{ url: string; type: string }> };
    expect(server.remotes[0]).toEqual({ type: 'streamable-http', url: MCP_PUBLIC_URL });
    expect(readFileSync('connectors/mcp/README.md', 'utf8')).toContain(MCP_PUBLIC_URL);
    expect(readFileSync('public/mcp.md', 'utf8')).toContain(MCP_PUBLIC_URL);
    expect(readFileSync('public/llm.txt', 'utf8')).toContain('Starter: 300');
  });
});

describe('MCP registry proof', () => {
  it('serves the owner token and hides the route when it is unset', async () => {
    const missing = await worker.fetch(new Request('https://www.luminarasuite.com/.well-known/mcp-registry-auth'), makeEnv(), execCtx);
    expect(missing.status).toBe(404);

    const set = await worker.fetch(
      new Request('https://luminarasuite.com/.well-known/mcp-registry-auth'),
      makeEnv(new Map(), { MCP_REGISTRY_AUTH_TOKEN: 'challenge-token' }),
      execCtx,
    );
    expect(set.status).toBe(200);
    expect(await set.text()).toBe('challenge-token');
  });
});
