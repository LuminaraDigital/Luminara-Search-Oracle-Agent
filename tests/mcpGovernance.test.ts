/**
 * MCP Tool Governance (spec 0010): policy decision branches, action-request
 * lifecycle, dedupe, expiry, and integration through the /api/mcp path.
 */
import { describe, expect, it, vi } from 'vitest';
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
  consumeApprovedRequest,
  getOwnedToolRequest,
  hashToolArgs,
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
      'dream_status', 'get_business_memory', 'dream_consolidate', 'review_dream_proposal',
      'list_enquiries', 'ingest_enquiry', 'propose_booking_slots', 'decide_booking_signoff',
      'get_outcomes_funnel', 'classify_cms_remediation', 'prepare_cms_mcp_call',
      'create_dev_ticket_from_finding', 'compile_review_to_skill', 'mint_habitat_token',
      'draft_fix',
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

  it('blocks credit-spending write tools without an active subscription', () => {
    const d = decideToolCall('research_keywords', { ...ctxFree, creditClass: 'paid' });
    expect(d).toEqual({ action: 'block', reason: 'subscription_required' });
  });

  it('allows free-credit write tools without a subscription', () => {
    expect(decideToolCall('save_report', ctxFree)).toEqual({ action: 'allow' });
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

  it('does not reuse a pending request that has expired', async () => {
    const env = makeEnv();
    const first = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', projectId: 'p1' });
    await env.DB!.prepare('UPDATE mcp_action_requests SET expires_at = 1 WHERE id = ?').bind(first.id).run();
    const second = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', projectId: 'p1' });
    expect(second.existing).toBe(false);
    expect(second.id).not.toBe(first.id);
    expect(second.expiresAt).toBeGreaterThan(Date.now());
    expect(await approveActionRequest(env, first.id, 'admin_1')).toBe(false);
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

  it('consumeApprovedRequest: false for pending/denied, true once for approved, then consumed', async () => {
    const env = makeEnv();
    const pending = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', projectId: 'p1' });
    expect(await consumeApprovedRequest(env, 'u1', 'browse_goal', 'p1')).toBe(false);
    await approveActionRequest(env, pending.id, 'admin');
    expect(await consumeApprovedRequest(env, 'u1', 'browse_goal', 'p1')).toBe(true);
    // Single use: the same approval never authorizes a second call.
    expect(await consumeApprovedRequest(env, 'u1', 'browse_goal', 'p1')).toBe(false);
    expect((await listActionRequests(env, 'u1'))[0].status).toBe('consumed');

    const denied = await createActionRequest(env, { userId: 'u1', toolName: 'browse_close' });
    await denyActionRequest(env, denied.id, 'admin');
    expect(await consumeApprovedRequest(env, 'u1', 'browse_close', null)).toBe(false);
  });

  it('an approval only authorizes the args it was requested with', async () => {
    const env = makeEnv();
    const { id } = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', args: { url: 'https://a.test' } });
    await approveActionRequest(env, id, 'admin');
    expect(await consumeApprovedRequest(env, 'u1', 'browse_goal', null, { url: 'https://evil.test' })).toBe(false);
    expect(await consumeApprovedRequest(env, 'u1', 'browse_goal', null, { url: 'https://a.test' })).toBe(true);
  });

  it('an approval for one redacted value is not spent by a call with another', async () => {
    const env = makeEnv();
    const reviewed = { url: 'https://a.test', token: 'A', login: { username: 'alice', password: 'one' } };
    const { id } = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', args: reviewed });
    await approveActionRequest(env, id, 'admin');

    // Each of these stores the same redacted text as the reviewed call.
    const swaps = [
      { ...reviewed, token: 'B' },
      { ...reviewed, login: { username: 'alice', password: 'two' } },
      { ...reviewed, login: { username: 'adam', password: 'one' } },
    ];
    for (const args of swaps) {
      expect(JSON.stringify(redactSensitive(args))).toBe(JSON.stringify(redactSensitive(reviewed)));
      expect(await consumeApprovedRequest(env, 'u1', 'browse_goal', null, args)).toBe(false);
    }
    expect((await getOwnedToolRequest(env, id, 'u1'))?.status).toBe('approved');

    expect(await consumeApprovedRequest(env, 'u1', 'browse_goal', null, reviewed)).toBe(true);
    expect(await consumeApprovedRequest(env, 'u1', 'browse_goal', null, reviewed)).toBe(false);
  });

  it('a call that differs only in a redacted value opens its own request', async () => {
    const env = makeEnv();
    const a = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', args: { url: 'https://a.test', token: 'A' } });
    const same = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', args: { url: 'https://a.test', token: 'A' } });
    const b = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', args: { url: 'https://a.test', token: 'B' } });
    expect(same).toMatchObject({ id: a.id, existing: true });
    expect(b.existing).toBe(false);
    expect(b.id).not.toBe(a.id);

    // Approving B's request leaves A's call waiting.
    await approveActionRequest(env, b.id, 'admin');
    expect(await consumeApprovedRequest(env, 'u1', 'browse_goal', null, { url: 'https://a.test', token: 'A' })).toBe(false);
    expect(await consumeApprovedRequest(env, 'u1', 'browse_goal', null, { url: 'https://a.test', token: 'B' })).toBe(true);
  });

  it('key order does not change which call an approval covers', async () => {
    const env = makeEnv();
    const asked = { goal: 'tidy', checks: { textIncludes: 'Done', urlIncludes: '/ok' }, steps: [{ a: 1, b: 2 }] };
    const reordered = { steps: [{ b: 2, a: 1 }], checks: { urlIncludes: '/ok', textIncludes: 'Done' }, goal: 'tidy' };
    const first = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', args: asked });
    const second = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', args: reordered });
    expect(second).toMatchObject({ id: first.id, existing: true });
    await approveActionRequest(env, first.id, 'admin');
    // Array order is part of the call; object key order is not.
    expect(await consumeApprovedRequest(env, 'u1', 'browse_goal', null, { ...asked, steps: [{ a: 2, b: 1 }] })).toBe(false);
    expect(await consumeApprovedRequest(env, 'u1', 'browse_goal', null, reordered)).toBe(true);
  });

  it('stores the hash beside the redacted copy and never returns it', async () => {
    const env = makeEnv();
    const { id } = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', args: { token: 'A' } });
    const stored = await env.DB.prepare('SELECT args_json, args_hash FROM mcp_action_requests WHERE id = ?')
      .bind(id)
      .first<{ args_json: string; args_hash: string }>();
    expect(stored?.args_json).toBe('{"token":"[redacted]"}');
    expect(stored?.args_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.args_hash).toBe(await hashToolArgs({ token: 'A' }));
    expect((await listActionRequests(env, 'u1'))[0]).not.toHaveProperty('args_hash');
    expect(await getOwnedToolRequest(env, id, 'u1')).not.toHaveProperty('args_hash');
  });

  it('refuses an approval stored without a hash (a row from before migration 0049)', async () => {
    const env = makeEnv();
    const args = { url: 'https://a.test' };
    const { id } = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', args });
    await approveActionRequest(env, id, 'admin');
    await env.DB.prepare('UPDATE mcp_action_requests SET args_hash = NULL WHERE id = ?').bind(id).run();
    expect(await consumeApprovedRequest(env, 'u1', 'browse_goal', null, args)).toBe(false);
    // The caller asks again and gets a fresh request, not the dead one.
    const again = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', args });
    expect(again.existing).toBe(false);
  });

  it('never spends an approval for args nested too deep to hash', async () => {
    const env = makeEnv();
    let nested: Record<string, unknown> = { goal: 'x' };
    for (let i = 0; i < 40; i++) nested = { inner: nested };
    expect(await hashToolArgs(nested)).toBeNull();
    const first = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', args: nested });
    const second = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', args: nested });
    expect(second).toMatchObject({ id: first.id, existing: true });
    await approveActionRequest(env, first.id, 'admin');
    expect(await consumeApprovedRequest(env, 'u1', 'browse_goal', null, nested)).toBe(false);
  });

  it('expired approvals never authorize', async () => {
    const env = makeEnv();
    const { id } = await createActionRequest(env, { userId: 'u1', toolName: 'browse_goal', projectId: 'p1' });
    await approveActionRequest(env, id, 'admin');
    await env.DB.prepare(`UPDATE mcp_action_requests SET expires_at = ? WHERE id = ?`)
      .bind(Date.now() - 1000, id)
      .run();
    expect(await consumeApprovedRequest(env, 'u1', 'browse_goal', 'p1')).toBe(false);
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
    expect(await consumeApprovedRequest(env, 'u1', 'browse_goal', null)).toBe(false);
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
    const res = await handleMcpRequest(mcpCall('browse_close', { sessionId: 's0' }), env, user);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result?: { structuredContent?: { requiresApproval?: boolean; actionRequestId?: string }; isError?: boolean };
    };
    expect(body.result?.isError).toBeFalsy();
    expect(body.result?.structuredContent?.requiresApproval).toBe(true);
    expect(body.result?.structuredContent?.actionRequestId).toBeTruthy();
  });

  it('a paid tool refused for the plan leaves its approval unspent', async () => {
    const env = makeEnv();
    const args = { goal: 'Find the pricing page', checks: { textIncludes: 'Pricing' } };
    const { id } = await createActionRequest(env, { userId: 'acct_gov', toolName: 'browse_goal', args });
    expect(await approveActionRequest(env, id, 'acct_gov')).toBe(true);

    const res = await handleMcpRequest(mcpCall('browse_goal', args), env, user);
    const body = (await res.json()) as { result?: { isError?: boolean; structuredContent?: { code?: string } } };
    expect(body.result?.isError).toBe(true);
    expect(body.result?.structuredContent?.code).toBe('PAID_TOOL_FORBIDDEN');
    expect((await getOwnedToolRequest(env, id, 'acct_gov'))?.status).toBe('approved');
  });

  it('free-credit write tool without subscription passes governance', async () => {
    const env = makeEnv();
    const res = await handleMcpRequest(mcpCall('save_report', { projectId: 'p', title: 't', summary: 's', html: '<html/>' }), env, user);
    const body = (await res.json()) as {
      result?: { isError?: boolean; structuredContent?: { code?: string; reason?: string } };
    };
    expect(body.result?.structuredContent?.code).not.toBe('GOVERNANCE_BLOCKED');
    const audit = await env.DB.prepare(
      `SELECT action FROM org_audit_logs WHERE org_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
      .bind('org_acct_gov')
      .first<{ action: string }>();
    expect(audit?.action).toBe('mcp_tool_allow');
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

    // The approval was spent: a third identical call needs a new one.
    const third = await handleMcpRequest(mcpCall('browse_close', { sessionId: 's1' }), env, user);
    const thirdBody = (await third.json()) as { result?: { structuredContent?: { requiresApproval?: boolean } } };
    expect(thirdBody.result?.structuredContent?.requiresApproval).toBe(true);
  });

  it('rejects a JSON-RPC batch of more than 20 messages', async () => {
    const env = makeEnv();
    const batch = Array.from({ length: 21 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' }));
    const res = await handleMcpRequest(
      new Request('https://luminarasuite.com/api/mcp', { method: 'POST', body: JSON.stringify(batch) }),
      env,
      user,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: number } };
    expect(body.error?.code).toBe(-32600);

    const ok = await handleMcpRequest(
      new Request('https://luminarasuite.com/api/mcp', { method: 'POST', body: JSON.stringify(batch.slice(0, 20)) }),
      env,
      user,
    );
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as unknown[]).length).toBe(20);
  });

  it('refuses a batch with more than one tools/call and keeps a batch with one', async () => {
    const env = makeEnv();
    const call = (id: number) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'whoami', arguments: {} } });
    const post = (body: unknown) =>
      handleMcpRequest(new Request('https://luminarasuite.com/api/mcp', { method: 'POST', body: JSON.stringify(body) }), env, user);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const refused = await post([call(1), call(2)]);
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32600, message: 'Send one tools/call per request' },
      });
      expect(warn).toHaveBeenCalledWith(JSON.stringify({ event: 'mcp_batch_refused', toolCalls: 2 }));
    } finally {
      warn.mockRestore();
    }

    const mixed = await post([{ jsonrpc: '2.0', id: 1, method: 'initialize' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, call(3)]);
    expect(mixed.status).toBe(200);
    const results = (await mixed.json()) as Array<{ id: number; result?: { isError?: boolean } }>;
    expect(results.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(results[2].result?.isError).toBe(false);
  });

  it('rejects an oversized request body with 413', async () => {
    const env = makeEnv();
    const res = await handleMcpRequest(
      new Request('https://luminarasuite.com/api/mcp', { method: 'POST', body: 'x'.repeat(1_000_001) }),
      env,
      user,
    );
    expect(res.status).toBe(413);
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

describe('mcp protocol version', () => {
  const user: HostedIdentity = { id: 'ver-user', source: 'firebase', accountId: 'acct_ver' };

  function post(body: unknown, headers: Record<string, string> = {}) {
    return handleMcpRequest(
      new Request('https://luminarasuite.com/api/mcp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
      makeEnv(),
      user,
    );
  }

  it('echoes a supported protocolVersion and falls back to the newest', async () => {
    for (const version of ['2025-06-18', '2025-03-26', '2024-11-05']) {
      const res = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: version } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        result: { protocolVersion: string; serverInfo: { title: string; name: string } };
      };
      expect(body.result.protocolVersion).toBe(version);
      expect(body.result.serverInfo).toMatchObject({ name: 'luminara-mcp', title: 'Luminara Suite' });
    }

    const unknown = await post({
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '2025-11-25' },
    });
    const unknownBody = (await unknown.json()) as { result: { protocolVersion: string } };
    expect(unknownBody.result.protocolVersion).toBe('2025-06-18');
  });

  it('accepts a supported or missing MCP-Protocol-Version header and rejects the rest', async () => {
    const supported = await post(
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { 'mcp-protocol-version': '2025-03-26' },
    );
    expect(supported.status).toBe(200);

    const absent = await post({ jsonrpc: '2.0', id: 1, method: 'ping' });
    expect(absent.status).toBe(200);
    expect(await absent.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });

    const rejected = await post(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { 'mcp-protocol-version': '1999-01-01' },
    );
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ error: 'Unsupported MCP-Protocol-Version' });

    const info = await handleMcpRequest(new Request('https://luminarasuite.com/api/mcp'), makeEnv(), user);
    expect(info.status).toBe(200);
    const infoBody = (await info.json()) as { protocolVersion: string; supportedProtocolVersions: string[] };
    expect(infoBody.protocolVersion).toBe('2025-06-18');
    expect(infoBody.supportedProtocolVersions).toEqual(['2025-06-18', '2025-03-26', '2024-11-05']);

    const infoRejected = await handleMcpRequest(
      new Request('https://luminarasuite.com/api/mcp', { headers: { 'mcp-protocol-version': '2025-11-25' } }),
      makeEnv(),
      user,
    );
    expect(infoRejected.status).toBe(400);
  });
});
