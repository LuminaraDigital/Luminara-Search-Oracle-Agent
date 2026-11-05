import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import { AGENT_ACTION_EXECUTING_MS, OracleSession } from '../worker/oracleSession';
import { decideAction, parkAction } from '../worker/oracleAgent/approvals';
import { buildAgentToolContext } from '../worker/oracleAgent/context';
import { admitAgentTurn, refundAgentTurn } from '../worker/oracleAgent/admission';
import { agentToolByName } from '../worker/oracleAgent/toolTable';
import { agentLimitsFor } from '../worker/oracleAgent/limits';
import { isAgentChatExemptRoute } from '../worker/apiAccess';
import { handleOracleSessionControlRoute } from '../worker/oracleChat';
import { createSqliteD1 } from './helpers/sqliteD1';
import { memoryDailyQuotaNamespace } from './helpers/memoryDailyQuota';

const YEAR = 365 * 86_400_000;
const user: HostedIdentity = { id: 'fb:owner', source: 'firebase', accountId: 'acct_a' };
const other: HostedIdentity = { id: 'fb:other', source: 'firebase', accountId: 'acct_b' };

function memoryDoState(): DurableObjectState {
  const store = new Map<string, unknown>();
  return {
    blockConcurrencyWhile: async <T>(fn: () => Promise<T>) => await fn(),
    storage: {
      get: async <T>(key: string) => store.get(key) as T | undefined,
      put: async (key: string, value: unknown) => void store.set(key, structuredClone(value)),
      delete: async (key: string) => store.delete(key),
      deleteAll: async () => store.clear(),
    },
  } as unknown as DurableObjectState;
}

function sessionStub(session = new OracleSession(memoryDoState())) {
  return {
    session,
    stub: { fetch: (input: string, init?: RequestInit) => session.fetch(new Request(input, init)) },
  };
}

function sessionNamespace(): DurableObjectNamespace {
  const sessions = new Map<string, OracleSession>();
  return {
    idFromName: (name: string) => ({ toString: () => name }) as unknown as DurableObjectId,
    get: (id: DurableObjectId) => {
      const key = id.toString();
      if (!sessions.has(key)) sessions.set(key, new OracleSession(memoryDoState()));
      const inst = sessions.get(key)!;
      return { fetch: (input: string, init?: RequestInit) => inst.fetch(new Request(input, init)) } as unknown as DurableObjectStub;
    },
  } as unknown as DurableObjectNamespace;
}

function makeEnv(plans: Record<string, string> = { acct_a: 'growth' }): Env {
  const kv = new Map<string, string>();
  for (const [acct, plan] of Object.entries(plans)) kv.set(`sub:${acct}`, JSON.stringify({ plan, expiresAt: Date.now() + YEAR }));
  return {
    ASSETS: { fetch: async () => new Response('ok') },
    LUMINARA_KV: {
      get: async (key: string, type?: string) => (kv.has(key) ? (type === 'json' ? JSON.parse(kv.get(key)!) : kv.get(key)) : null),
      put: async (key: string, value: string) => void kv.set(key, value),
      delete: async (key: string) => void kv.delete(key),
    } as unknown as KVNamespace,
    DB: createSqliteD1(),
    DAILY_QUOTA: memoryDailyQuotaNamespace(),
    ORACLE_SESSION: sessionNamespace(),
    ORACLE_SERVER_ENABLED: 'true',
    ORACLE_AGENT_ENABLED: 'true',
    WEBAPP_URL: 'https://luminarasuite.com/',
  } as Env;
}

async function addProject(env: Env, accountId: string, id: string, domain: string) {
  const now = Date.now();
  await env
    .DB!.prepare(`INSERT INTO projects (id, account_id, client_id, domain, name, created_at, updated_at) VALUES (?, ?, '', ?, ?, ?, ?)`)
    .bind(id, accountId, domain, domain, now, now)
    .run();
}

async function parkWatch(env: Env, stub: { fetch: (i: string, init?: RequestInit) => Promise<Response> }, who = user, projectId = 'proj_1') {
  const ctx = await buildAgentToolContext({ env, user: who, projectId, byokHeader: null, runId: null });
  const tool = agentToolByName('create_watch')!;
  expect(await tool.gate(ctx)).toBeNull();
  const prepared = await tool.prepare!({ engine: 'chatgpt', prompts: ['best plumber near me', 'emergency plumber'], domain: 'evil.example' }, ctx);
  if (!prepared.ok) throw new Error(prepared.error);
  const parked = await parkAction({ stub, tool, prepared, ctx, turnId: 'turn_1' });
  if (!parked.ok) throw new Error(parked.error);
  return { actionId: parked.actionId, prepared };
}

const watchCount = (env: Env) => env.DB!.prepare(`SELECT COUNT(*) AS n FROM citation_watches`).first<{ n: number }>();

afterEach(() => {
  vi.restoreAllMocks();
});

describe('approval cards', () => {
  it('builds the card from the project, not from model arguments', async () => {
    const env = makeEnv();
    await addProject(env, 'acct_a', 'proj_1', 'acme.com');
    const { stub } = sessionStub();
    const { prepared } = await parkWatch(env, stub);
    expect(prepared.args.domain).toBe('acme.com');
    expect(prepared.preview).toContain('acme.com');
    expect(prepared.preview).not.toContain('evil.example');
  });

  it('runs an approved action exactly once', async () => {
    const env = makeEnv();
    await addProject(env, 'acct_a', 'proj_1', 'acme.com');
    const { stub } = sessionStub();
    const { actionId } = await parkWatch(env, stub);
    const first = await decideAction({ env, user, stub, actionId, approved: true, byokHeader: null });
    expect(first).toMatchObject({ ok: true, status: 'approved_done' });
    expect((await watchCount(env))?.n).toBe(1);
    const second = await decideAction({ env, user, stub, actionId, approved: true, byokHeader: null });
    expect(second.status).toBe('already_decided');
    expect((await watchCount(env))?.n).toBe(1);
  });

  it('runs once when two approvals race', async () => {
    const env = makeEnv();
    await addProject(env, 'acct_a', 'proj_1', 'acme.com');
    const { stub } = sessionStub();
    const { actionId } = await parkWatch(env, stub);
    const results = await Promise.all([
      decideAction({ env, user, stub, actionId, approved: true, byokHeader: null }),
      decideAction({ env, user, stub, actionId, approved: true, byokHeader: null }),
    ]);
    expect(results.filter((r) => r.status === 'approved_done')).toHaveLength(1);
    expect((await watchCount(env))?.n).toBe(1);
  });

  it('does nothing on reject, and refuses another account', async () => {
    const env = makeEnv({ acct_a: 'growth', acct_b: 'growth' });
    await addProject(env, 'acct_a', 'proj_1', 'acme.com');
    const { stub } = sessionStub();
    const { actionId } = await parkWatch(env, stub);
    expect((await decideAction({ env, user: other, stub, actionId, approved: true, byokHeader: null })).status).toBe('forbidden');
    expect((await decideAction({ env, user, stub, actionId, approved: false, byokHeader: null })).status).toBe('denied');
    expect((await watchCount(env))?.n).toBe(0);
  });

  it('expires a card after 30 minutes', async () => {
    const env = makeEnv();
    await addProject(env, 'acct_a', 'proj_1', 'acme.com');
    const { stub } = sessionStub();
    const { actionId } = await parkWatch(env, stub);
    const later = Date.now() + 31 * 60 * 1000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    expect((await decideAction({ env, user, stub, actionId, approved: true, byokHeader: null })).status).toBe('expired');
    expect((await watchCount(env))?.n).toBe(0);
  });

  it('reports an unknown outcome when an approved action stays executing, and never retries it', async () => {
    const { session, stub } = sessionStub();
    const actionId = '22222222-2222-4222-8222-222222222222';
    await stub.fetch('https://oracle-session/action/park', {
      method: 'POST',
      body: JSON.stringify({ actionId, toolName: 'create_watch', args: {}, requesterId: 'acct_a', preview: 'p' }),
    });
    const claimed = await (await stub.fetch('https://oracle-session/action/claim', {
      method: 'POST',
      body: JSON.stringify({ actionId, requesterId: 'acct_a', approved: true }),
    })).json();
    expect(claimed).toMatchObject({ ok: true, status: 'executing' });
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + AGENT_ACTION_EXECUTING_MS + 1000);
    const history = (await (await session.fetch(new Request('https://oracle-session/history'))).json()) as { actions: Array<Record<string, unknown>> };
    expect(history.actions[0].status).toBe('failed_unknown');
    const again = await stub.fetch('https://oracle-session/action/claim', {
      method: 'POST',
      body: JSON.stringify({ actionId, requesterId: 'acct_a', approved: true }),
    });
    expect(again.status).toBe(409);
  });

  it('refuses an action whose stored arguments do not match its card', async () => {
    const env = makeEnv();
    await addProject(env, 'acct_a', 'proj_1', 'acme.com');
    const { stub } = sessionStub();
    const actionId = '33333333-3333-4333-8333-333333333333';
    await stub.fetch('https://oracle-session/action/park', {
      method: 'POST',
      body: JSON.stringify({
        actionId,
        toolName: 'create_watch',
        args: { domain: 'acme.com', engine: 'chatgpt', prompts: ['a'], cadence: 'weekly' },
        argsHash: 'not-the-hash',
        projectId: 'proj_1',
        requesterId: 'acct_a',
        preview: 'p',
      }),
    });
    const res = await decideAction({ env, user, stub, actionId, approved: true, byokHeader: null });
    expect(res.status).toBe('failed');
    expect((await watchCount(env))?.n).toBe(0);
  });

  it('shows cards in history without their arguments', async () => {
    const env = makeEnv();
    await addProject(env, 'acct_a', 'proj_1', 'acme.com');
    const { session, stub } = sessionStub();
    await parkWatch(env, stub);
    const history = (await (await session.fetch(new Request('https://oracle-session/history'))).json()) as { actions: Array<Record<string, unknown>> };
    expect(history.actions).toHaveLength(1);
    expect(history.actions[0]).not.toHaveProperty('args');
    expect(history.actions[0]).not.toHaveProperty('requesterId');
    expect(history.actions[0]).toMatchObject({ status: 'pending', tainted: true });
  });

  it('keeps the session writable when a tool input is huge', async () => {
    const { session } = sessionStub();
    const huge = { body: 'x'.repeat(50_000) };
    const res = await session.fetch(
      new Request('https://oracle-session/events', {
        method: 'POST',
        body: JSON.stringify({ events: [{ type: 'tool_start', tool_id: 't1', tool_name: 'save_report', tool_input: huge }] }),
      }),
    );
    const body = (await res.json()) as { published: Array<{ event: { tool_input?: Record<string, unknown> } }> };
    expect(JSON.stringify(body.published[0].event.tool_input).length).toBeLessThan(2100);
    expect(body.published[0].event.tool_input).toMatchObject({ truncated: true });
  });
});

describe('who may start an agent turn', () => {
  it('caps a free account at five turns a day; a continue turn skips the account meter', async () => {
    const env = makeEnv({});
    const limits = agentLimitsFor('free');
    for (let i = 0; i < 5; i++) {
      expect((await admitAgentTurn({ env, accountId: 'acct_free', ip: null, limits, isContinue: false })).ok).toBe(true);
    }
    const sixth = await admitAgentTurn({ env, accountId: 'acct_free', ip: null, limits, isContinue: false });
    expect(sixth).toMatchObject({ ok: false, which: 'account' });
    expect((await admitAgentTurn({ env, accountId: 'acct_free', ip: null, limits, isContinue: true })).ok).toBe(true);
  });

  it('gives the turn back when the agent produced no answer', async () => {
    const env = makeEnv({});
    const limits = agentLimitsFor('free');
    let last;
    for (let i = 0; i < 5; i++) last = await admitAgentTurn({ env, accountId: 'acct_r', ip: null, limits, isContinue: false });
    await refundAgentTurn(env, last!);
    expect((await admitAgentTurn({ env, accountId: 'acct_r', ip: null, limits, isContinue: false })).ok).toBe(true);
  });

  it('fails closed when the meter is missing', async () => {
    const env = { ...makeEnv({}), DAILY_QUOTA: undefined } as Env;
    expect((await admitAgentTurn({ env, accountId: 'a', ip: null, limits: agentLimitsFor('free'), isContinue: false })).ok).toBe(false);
  });

  it('applies the per-IP and global ceilings', async () => {
    const env = { ...makeEnv({}), ORACLE_AGENT_IP_TURNS: '2', ORACLE_AGENT_GLOBAL_TURNS: '3' } as Env;
    const limits = agentLimitsFor('agency');
    expect((await admitAgentTurn({ env, accountId: 'a1', ip: '1.1.1.1', limits, isContinue: false })).ok).toBe(true);
    expect((await admitAgentTurn({ env, accountId: 'a2', ip: '1.1.1.1', limits, isContinue: false })).ok).toBe(true);
    expect(await admitAgentTurn({ env, accountId: 'a3', ip: '1.1.1.1', limits, isContinue: false })).toMatchObject({ ok: false, which: 'ip' });
    expect(await admitAgentTurn({ env, accountId: 'a4', ip: '2.2.2.2', limits, isContinue: false })).toMatchObject({ ok: false, which: 'global' });
  });

  it('exempts only chat, approval, history and events, and only with the flag on', () => {
    const on = { ORACLE_AGENT_ENABLED: 'true' } as Env;
    const off = { ORACLE_AGENT_ENABLED: 'false' } as Env;
    expect(isAgentChatExemptRoute(on, '/oracle/chat')).toBe(true);
    expect(isAgentChatExemptRoute(on, '/oracle/session/default/approval')).toBe(true);
    expect(isAgentChatExemptRoute(on, '/oracle/session/default/state/patch')).toBe(false);
    expect(isAgentChatExemptRoute(on, '/oracle/session/default/callback')).toBe(false);
    expect(isAgentChatExemptRoute(off, '/oracle/chat')).toBe(false);
  });

  it('narrows the session route for a free plan to its own session', async () => {
    const env = makeEnv({});
    const freeUser: HostedIdentity = { id: 'fb:free', source: 'firebase', accountId: 'acct_free' };
    const patch = await handleOracleSessionControlRoute(
      new Request('https://x/api/oracle/session/sess_any/state/patch', { method: 'POST', body: '{}' }),
      env,
      freeUser,
      'sess_any',
      'state/patch',
    );
    expect(patch.status).toBe(403);
    const history = await handleOracleSessionControlRoute(new Request('https://x/api/oracle/session/default/history'), env, freeUser, 'default', 'history');
    expect(history.status).toBe(200);
    const legacy = await handleOracleSessionControlRoute(
      new Request('https://x/api/oracle/session/default/approval', { method: 'POST', body: JSON.stringify({ toolId: 'call_1', approved: true }) }),
      env,
      freeUser,
      'default',
      'approval',
    );
    expect(legacy.status).toBe(400);
  });
});
