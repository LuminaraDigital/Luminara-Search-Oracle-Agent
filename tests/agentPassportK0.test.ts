/**
 * Agent Passport K0: audit chain id unification, OAuth scope enforcement on paid
 * MCP tools, and credential attribution on cost_events. Real migrations via sqliteD1.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/env';
import { handleMcpRequest } from '../worker/mcpServer';
import { auditOrgIdFor, getAuditLogs, recordAuditLog } from '../worker/auditLog';
import { identifyMcpOAuthToken } from '../worker/mcpOAuth';
import { sha256Hex } from '../worker/workerUtils';
import { credentialAllowsResearch, type HostedIdentity, type McpCredential } from '../worker/userTypes';
import { createSqliteD1 } from './helpers/sqliteD1';

afterEach(() => {
  vi.restoreAllMocks();
});

function mockKv(store = new Map<string, string>()): KVNamespace {
  return {
    get: async (key: string, type?: string | { type?: string }) => {
      const v = store.get(key);
      if (v === undefined) return null;
      const t = typeof type === 'string' ? type : undefined;
      return t === 'json' ? JSON.parse(v) : v;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

function makeEnv(store = new Map<string, string>()): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: mockKv(store),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
  } as Env;
}

function mcpCall(name: string, args: Record<string, unknown>, headers: Record<string, string> = {}): Request {
  return new Request('https://luminarasuite.com/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
}

type ToolBody = { result?: { isError?: boolean; structuredContent?: Record<string, unknown> } };

const ACCOUNT = 'acct_k0';
const user: HostedIdentity = { id: 'k0-user', source: 'firebase', accountId: ACCOUNT };

function agencyKvWithContext(): Map<string, string> {
  return new Map([
    [`sub:${ACCOUNT}`, JSON.stringify({ plan: 'agency', expiresAt: Date.now() + 86_400_000 })],
    [`mcp:context_loaded:${ACCOUNT}:p1`, String(Date.now())],
  ]);
}

describe('auditOrgIdFor', () => {
  it('matches the personal org id minted by getOrCreateUserOrg', () => {
    expect(auditOrgIdFor('acct_1')).toBe('org_acct_1');
    expect(auditOrgIdFor('tg:123@x')).toBe('org_tg_123_x');
  });

  it('MCP decisions land in the personal org chain, not the raw account id', async () => {
    const env = makeEnv(new Map());
    await handleMcpRequest(mcpCall('whoami', {}), env, user);
    const personal = await env.DB!.prepare(`SELECT COUNT(*) AS n FROM org_audit_logs WHERE org_id = ?`)
      .bind('org_acct_k0')
      .first<{ n: number }>();
    const raw = await env.DB!.prepare(`SELECT COUNT(*) AS n FROM org_audit_logs WHERE org_id = ?`)
      .bind(ACCOUNT)
      .first<{ n: number }>();
    expect(personal?.n).toBeGreaterThan(0);
    expect(raw?.n).toBe(0);
  });

  it('getAuditLogs merges legacy raw-account rows without touching their chain', async () => {
    const env = makeEnv(new Map());
    await recordAuditLog(env, { org_id: ACCOUNT, actor_id: 'u', action: 'mcp_tool_allow' });
    await recordAuditLog(env, { org_id: 'org_acct_k0', actor_id: 'u', action: 'license.activate' });
    const withoutLegacy = await getAuditLogs(env, 'org_acct_k0');
    expect(withoutLegacy.total).toBe(1);
    const merged = await getAuditLogs(env, 'org_acct_k0', { legacyOrgIds: [ACCOUNT] });
    expect(merged.total).toBe(2);
    expect(merged.entries.map((e) => e.action).sort()).toEqual(['license.activate', 'mcp_tool_allow']);
    const legacyRow = merged.entries.find((e) => e.action === 'mcp_tool_allow');
    expect(legacyRow?.org_id).toBe(ACCOUNT);
  });

  it('getAuditLogs ignores duplicate and empty legacy ids', async () => {
    const env = makeEnv(new Map());
    await recordAuditLog(env, { org_id: 'org_acct_k0', actor_id: 'u', action: 'a' });
    const res = await getAuditLogs(env, 'org_acct_k0', { legacyOrgIds: ['', 'org_acct_k0'] });
    expect(res.total).toBe(1);
  });
});

describe('credentialAllowsResearch', () => {
  it('unrestricted credentials (null scopes) allow research', () => {
    expect(credentialAllowsResearch({ kind: 'api_key', id: 'k', scopes: null })).toBe(true);
  });
  it('mcp:free only denies research', () => {
    expect(credentialAllowsResearch({ kind: 'oauth', id: null, scopes: ['mcp:free'] })).toBe(false);
  });
  it('mcp:research allows research', () => {
    expect(credentialAllowsResearch({ kind: 'oauth', id: null, scopes: ['mcp:free', 'mcp:research'] })).toBe(true);
  });
});

describe('MCP scope gate', () => {
  const freeOnly: McpCredential = { kind: 'oauth', id: null, scopes: ['mcp:free'] };
  const research: McpCredential = { kind: 'oauth', id: null, scopes: ['mcp:free', 'mcp:research'] };

  it('blocks hosted paid tools for an mcp:free OAuth credential with an instructive error', async () => {
    const env = makeEnv(agencyKvWithContext());
    const res = await handleMcpRequest(
      mcpCall('get_pagespeed_summary', { projectId: 'p1', url: 'https://x.test' }),
      env,
      user,
      freeOnly,
    );
    const body = (await res.json()) as ToolBody;
    expect(body.result?.isError).toBe(true);
    expect(body.result?.structuredContent?.code).toBe('SCOPE_INSUFFICIENT');
    expect(body.result?.structuredContent?.requiredScope).toBe('mcp:research');
    const cost = await env.DB!.prepare(`SELECT COUNT(*) AS n FROM cost_events`).first<{ n: number }>();
    expect(cost?.n).toBe(0);
  });

  it('free tools still work for an mcp:free credential', async () => {
    const env = makeEnv(agencyKvWithContext());
    const res = await handleMcpRequest(mcpCall('whoami', {}), env, user, freeOnly);
    const body = (await res.json()) as ToolBody;
    expect(body.result?.isError).toBeFalsy();
  });

  it('allows paid tools for an mcp:research credential', async () => {
    const env = makeEnv(agencyKvWithContext());
    const res = await handleMcpRequest(
      mcpCall('get_pagespeed_summary', { projectId: 'p1', url: 'https://x.test' }),
      env,
      user,
      research,
    );
    const body = (await res.json()) as ToolBody;
    expect(body.result?.structuredContent?.code).not.toBe('SCOPE_INSUFFICIENT');
    expect(body.result?.isError).toBeFalsy();
  });

  it('BYOK lets an mcp:free credential through the scope gate (no hosted spend)', async () => {
    const env = makeEnv(agencyKvWithContext());
    const res = await handleMcpRequest(
      mcpCall('get_pagespeed_summary', { projectId: 'p1', url: 'https://x.test' }, { 'x-provider-key': 'login@x.test:secret' }),
      env,
      user,
      freeOnly,
    );
    const body = (await res.json()) as ToolBody;
    expect(body.result?.structuredContent?.code).not.toBe('SCOPE_INSUFFICIENT');
  });

  it('default credential (no 4th arg) stays unrestricted for backward compatibility', async () => {
    const env = makeEnv(agencyKvWithContext());
    const res = await handleMcpRequest(
      mcpCall('get_pagespeed_summary', { projectId: 'p1', url: 'https://x.test' }),
      env,
      user,
    );
    const body = (await res.json()) as ToolBody;
    expect(body.result?.structuredContent?.code).not.toBe('SCOPE_INSUFFICIENT');
  });
});

describe('cost attribution', () => {
  it('records credential kind and id on hosted paid cost events', async () => {
    const env = makeEnv(agencyKvWithContext());
    await handleMcpRequest(
      mcpCall('get_pagespeed_summary', { projectId: 'p1', url: 'https://x.test' }),
      env,
      user,
      { kind: 'api_key', id: 'key_abc', scopes: null },
    );
    const row = await env.DB!.prepare(
      `SELECT credential_kind, credential_id FROM cost_events WHERE account_id = ?`,
    )
      .bind(ACCOUNT)
      .first<{ credential_kind: string; credential_id: string }>();
    expect(row?.credential_kind).toBe('api_key');
    expect(row?.credential_id).toBe('key_abc');
  });
});

describe('OAuth token scope marker', () => {
  async function putToken(store: Map<string, string>, token: string, record: Record<string, unknown>) {
    store.set(`mcp_oauth_token:${await sha256Hex(token)}`, JSON.stringify(record));
  }

  it('new tokens report scopeEnforced true', async () => {
    const store = new Map<string, string>();
    await putToken(store, 'mcp_new', { accountId: ACCOUNT, userId: 'u', plan: 'growth', scope: 'mcp:free', scopeEnforced: true });
    const id = await identifyMcpOAuthToken(makeEnv(store), 'mcp_new');
    expect(id?.scopeEnforced).toBe(true);
    expect(id?.scope).toBe('mcp:free');
  });

  it('legacy tokens without the marker are not scope-enforced (TTL drain)', async () => {
    const store = new Map<string, string>();
    await putToken(store, 'mcp_old', { accountId: ACCOUNT, userId: 'u', plan: 'agency', scope: 'mcp:free' });
    const id = await identifyMcpOAuthToken(makeEnv(store), 'mcp_old');
    expect(id?.scopeEnforced).toBe(false);
  });
});
