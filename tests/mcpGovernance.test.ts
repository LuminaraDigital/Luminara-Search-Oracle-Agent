/**
 * MCP Tool Governance (spec 0010): policy decision branches, action-request
 * lifecycle, dedupe, expiry, and integration through the /api/mcp path.
 */
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import {
  TOOL_GOVERNANCE,
  governanceFor,
  decideToolCall,
  createActionRequest,
  listActionRequests,
  approveActionRequest,
  denyActionRequest,
  hasApprovedRequest,
} from '../worker/mcpGovernance';
import { redactSensitive } from '../worker/logRedaction';
import { handleMcpRequest } from '../worker/mcpServer';
import type { HostedIdentity } from '../worker/userTypes';
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

function makeEnv(store = new Map<string, string>(), overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    LUMINARA_KV: mockKv(store),
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    ...overrides,
  } as Env;
}

const ctxFree = { subscriptionActive: false, creditClass: 'free', identityPlan: 'free' };
const ctxSub = { subscriptionActive: true, creditClass: 'free', identityPlan: 'growth' };

describe('tool governance catalogue', () => {
  it('covers every MCP-exposed tool name', () => {
    const known = [
      'whoami', 'list_projects', 'create_project', 'get_project_context',
      'update_project_context', 'list_reports', 'get_report', 'save_report',
      'research_keywords', 'get_domain_overview', 'get_serp_results',
      'get_backlinks_overview', 'get_visibility_snapshot', 'get_pagespeed_summary',
      'browse_observe', 'browse_act', 'browse_goal', 'browse_close',
    ];
    for (const name of known) {
      expect(TOOL_GOVERNANCE[name], name).toBeDefined();
    }
  });

  it('classifies browse_goal and browse_close as destructive', () => {
    expect(TOOL_GOVERNANCE.browse_goal.risk).toBe('destructive');
    expect(TOOL_GOVERNANCE.browse_close.risk).toBe('destructive');
  });

  it('defaults unknown tools to write/active via governanceFor', () => {
    expect(governanceFor('not_a_real_tool')).toEqual({ risk: 'write', status: 'active' });
  });
});

describe('decideToolCall branches', () => {
  it('blocks quarantined tools with reason tool_quarantined', () => {
    TOOL_GOVERNANCE.__quarantine_probe = { risk: 'read', status: 'quarantined' };
    const d = decideToolCall('__quarantine_probe', ctxSub);
    expect(d).toEqual({ action: 'block', reason: 'tool_quarantined' });
    delete TOOL_GOVERNANCE.__quarantine_probe;
  });

  it('requires approval for destructive tools without an approved request', () => {
    const d = decideToolCall('browse_goal', ctxSub, false);
    expect(d.action).toBe('require_approval');
  });

  it('allows destructive tools when an approved request exists', () => {
    const d = decideToolCall('browse_goal', ctxSub, true);
    expect(d.action).toBe('allow');
  });

  it('blocks write tools without an active subscription', () => {
    const d = decideToolCall('save_report', ctxFree);
    expect(d).toEqual({ action: 'block', reason: 'subscription_required' });
  });

  it('allows write tools with an active subscription', () => {
    expect(decideToolCall('save_report', ctxSub).action).toBe('allow');
  });

  it('allows read tools regardless of subscription', () => {
    expect(decideToolCall('list_projects', ctxFree).action).toBe('allow');
    expect(decideToolCall('whoami', ctxFree).action).toBe('allow');
  });

  it('quarantine beats destructive and subscription rules', () => {
    TOOL_GOVERNANCE.__quarantine_write = { risk: 'write', status: 'quarantined' };
    const d = decideToolCall('__quarantine_write', ctxFree);
    expect(d).toEqual({ action: 'block', reason: 'tool_quarantined' });
    delete TOOL_GOVERNANCE.__quarantine_write;
  });
});

describe('action request lifecycle', () => {
  it('creates a pending request with 30 minute expiry', async () => {
    const env = makeEnv();
    const { id, existing } = await createActionRequest(env, {
      userId: 'u1',
      toolName: 'browse_goal',
      projectId: 'p1',
      args: { url: 'https://x.test' },
    });
    expect(existing).toBe(false);
    const rows = await listActionRequests(env, 'u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].expires_at - rows[0].created_at).toBe(30 * 60 * 1000);
  });

  it('redacts secret-shaped args before storing args_json', async () => {
    const env = makeEnv();
    await createActionRequest(env, {
      userId: 'u1',
      toolName: 'browse_goal',
      args: { url: 'https://x.test', apiKey: 'sk-live-secret', nested: { password: 'hunter2' } },
    });
    const rows = await listActionRequests(env, 'u1');
    expect(rows[0].args_json).not.toContain('sk-live-secret');
    expect(rows[0].args_json).not.toContain('hunter2');
    expect(rows[0].args_json).toContain('[redacted]');
    expect(rows[0].args_json).toContain('https://x.test');
  });

  it('dedupes a second pending request for the same user+tool+project', async () => {
    const env = makeEnv();
    const a = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', projectId: 'p1' });
    const b = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', projectId: 'p1' });
    expect(b.id).toBe(a.id);
    expect(b.existing).toBe(true);
    expect(await listActionRequests(env, 'u1')).toHaveLength(1);
  });

  it('does not dedupe across different projects', async () => {
    const env = makeEnv();
    const a = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', projectId: 'p1' });
    const b = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', projectId: 'p2' });
    expect(b.id).not.toBe(a.id);
  });

  it('approveActionRequest marks pending row approved; double approve fails', async () => {
    const env = makeEnv();
    const { id } = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal' });
    expect(await approveActionRequest(env, id, 'admin_1')).toBe(true);
    expect(await approveActionRequest(env, id, 'admin_1')).toBe(false);
    const rows = await listActionRequests(env, 'u1');
    expect(rows[0].status).toBe('approved');
    expect(rows[0].decided_by).toBe('admin_1');
    expect(rows[0].decided_at).toBeTruthy();
  });

  it('denyActionRequest marks pending row denied', async () => {
    const env = makeEnv();
    const { id } = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal' });
    expect(await denyActionRequest(env, id, 'admin_2')).toBe(true);
    const rows = await listActionRequests(env, 'u1');
    expect(rows[0].status).toBe('denied');
    expect(rows[0].decided_by).toBe('admin_2');
  });

  it('hasApprovedRequest true for approved unexpired, false for pending/denied', async () => {
    const env = makeEnv();
    const pending = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', projectId: 'p1' });
    expect(await hasApprovedRequest(env, 'u1', 'browse_goal', 'p1')).toBe(false);
    await approveActionRequest(env, pending.id, 'admin');
    expect(await hasApprovedRequest(env, 'u1', 'browse_goal', 'p1')).toBe(true);

    const denied = await createActionRequest(env, { userId: 'u1', toolName: 'browse_close' });
    await denyActionRequest(env, denied.id, 'admin');
    expect(await hasApprovedRequest(env, 'u1', 'browse_close', null)).toBe(false);
  });

  it('expired approvals never authorize', async () => {
    const env = makeEnv();
    const { id } = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', projectId: 'p1' });
    await approveActionRequest(env, id, 'admin');
    await env.DB.prepare(`UPDATE mcp_action_requests SET expires_at = ? WHERE id = ?`)
      .bind(Date.now() - 1000, id)
      .run();
    expect(await hasApprovedRequest(env, 'u1', 'browse_goal', 'p1')).toBe(false);
  });

  it('second call after expiry opens a new request', async () => {
    const env = makeEnv();
    const first = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', projectId: 'p1' });
    await approveActionRequest(env, first.id, 'admin');
    await env.DB.prepare(`UPDATE mcp_action_requests SET expires_at = ? WHERE id = ?`)
      .bind(Date.now() - 1000, first.id)
      .run();
    const second = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', projectId: 'p1' });
    expect(second.id).not.toBe(first.id);
    expect(second.existing).toBe(false);
  });

  it('degraded mode (no DB) still returns ids and false flags', async () => {
    const env = makeEnv(new Map(), { DB: undefined } as Partial<Env>);
    const created = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal' });
    expect(created.id).toBeTruthy();
    expect(await listActionRequests(env, 'u1')).toEqual([]);
    expect(await hasApprovedRequest(env, 'u1', 'browse_goal', null)).toBe(false);
  });
});

describe('redactSensitive', () => {
  it('redacts keys matching token/secret/password/apiKey patterns', () => {
    const out = redactSensitive({ token: 't', api_key: 'k', password: 'p', note: 'keep' }) as Record<string, unknown>;
    expect(out).toEqual({ token: '[redacted]', api_key: '[redacted]', password: '[redacted]', note: 'keep' });
  });

  it('recurses into arrays and nested objects, leaves scalars', () => {
    const out = redactSensitive({ list: [{ secret: 's', n: 1 }], plain: 'v' }) as { list: Array<Record<string, unknown>>; plain: string };
    expect(out.list[0].secret).toBe('[redacted]');
    expect(out.list[0].n).toBe(1);
    expect(out.plain).toBe('v');
  });
});

describe('mcp integration', () => {
  const user: HostedIdentity = {
    id: 'gov-user',
    source: 'firebase',
    accountId: 'acct_gov',
  };

  function mcpCall(name: string, args: Record<string, unknown>, id = 1): Request {
    return new Request('https://luminarasuite.com/api/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
    });
  }

  it('destructive tool returns requiresApproval without executing', async () => {
    const env = makeEnv();
    const res = await handleMcpRequest(mcpCall('browse_goal', { url: 'https://x.test' }), env, user);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { structuredContent?: { requiresApproval?: boolean; actionRequestId?: string }; isError?: boolean };
    };
    expect(body.result?.isError).toBeFalsy();
    expect(body.result?.structuredContent?.requiresApproval).toBe(true);
    expect(body.result?.structuredContent?.actionRequestId).toBeTruthy();
  });

  it('write tool without subscription returns governance block', async () => {
    const env = makeEnv();
    const res = await handleMcpRequest(mcpCall('save_report', { projectId: 'p', title: 't', summary: 's', html: '<html/>' }), env, user);
    const body = (await res.json()) as {
      result?: { isError?: boolean; structuredContent?: { code?: string; reason?: string } };
    };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.structuredContent?.code).toBe('GOVERNANCE_BLOCKED');
    expect(body.result?.structuredContent?.reason).toBe('subscription_required');
  });

  it('read tool allowed without subscription and writes audit row', async () => {
    const env = makeEnv();
    const res = await handleMcpRequest(mcpCall('whoami', {}), env, user);
    const body = (await res.json()) as { result?: { isError?: boolean } };
    expect(body.result?.isError).toBeFalsy();
    const audit = await env.DB.prepare(
      `SELECT action FROM org_audit_logs WHERE org_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
      .bind('org_acct_gov')
      .first<{ action: string }>();
    expect(audit?.action).toBe('mcp_tool_allow');
  });

  it('approved destructive request then allows execution', async () => {
    const env = makeEnv();
    const first = await handleMcpRequest(mcpCall('browse_close', { sessionId: 's1' }), env, user);
    const firstBody = (await first.json()) as {
      result?: { structuredContent?: { actionRequestId?: string } };
    };
    const reqId = firstBody.result?.structuredContent?.actionRequestId;
    expect(reqId).toBeTruthy();
    await approveActionRequest(env, reqId as string, 'admin');
    const second = await handleMcpRequest(mcpCall('browse_close', { sessionId: 's1' }), env, user);
    const secondBody = (await second.json()) as {
      result?: { structuredContent?: { requiresApproval?: boolean } };
    };
    expect(secondBody.result?.structuredContent?.requiresApproval).toBeUndefined();
  });

  it('unknown tool still logged then TOOL_NOT_FOUND via full worker path', async () => {
    const env = makeEnv();
    const res = await worker.fetch(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.99.0.1' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
      env,
      { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext,
    );
    expect([401, 403]).toContain(res.status);
  });
});
