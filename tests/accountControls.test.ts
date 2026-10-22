import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/env';
import type { HostedIdentity } from '../worker/userTypes';
import { createSqliteD1 } from './helpers/sqliteD1';
import { checksLeftLine, planDetailLine, planTitle } from '../services/account/accountSummary';

const verifyFirebaseIdToken = vi.fn();

vi.mock('../worker/firebaseAuth', () => ({
  verifyFirebaseIdToken: (...args: unknown[]) => verifyFirebaseIdToken(...args),
}));

const user: HostedIdentity = {
  id: 'fb:abc',
  source: 'firebase',
  accountId: 'acct1',
  email: 'ada@example.com',
};

function envOf(): Env {
  const store = new Map<string, string>();
  return {
    DB: createSqliteD1(),
    FIREBASE_PROJECT_ID: 'luminara-suite',
    FIREBASE_WEB_API_KEY: 'web-key',
    LUMINARA_KV: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => { store.set(key, value); },
      delete: async (key: string) => { store.delete(key); },
    },
  } as unknown as Env;
}

async function seed(env: Env) {
  const db = env.DB!;
  await db.prepare(
    `INSERT INTO users (id, source, email, firebase_uid, created_at, last_seen_at, account_id) VALUES (?, 'firebase', ?, 'abc', 1, 1, ?)`,
  ).bind(user.id, user.email, user.accountId).run();
  await db.prepare(`INSERT INTO user_workspace (account_id, payload, updated_at) VALUES (?, '{}', 1)`).bind(user.accountId).run();
  await db.prepare(
    `INSERT INTO audit_runs (id, account_id, domain, focus, status, created_at) VALUES ('run1', ?, 'example.com', 'audit', 'done', 1)`,
  ).bind(user.accountId).run();
  await db.prepare(
    `INSERT INTO audit_findings (id, audit_run_id, account_id, domain, stable_key, category, severity, title, description, created_at, updated_at)
     VALUES ('f1', 'run1', ?, 'example.com', 'nap', 'local', 'high', 'Add the suburb', 'Missing', 1, 1)`,
  ).bind(user.accountId).run();
  await db.prepare(
    `INSERT INTO win_shares (id, owner_id, agency_name, claim_kind, passed, total, fixes_done, hide_score, created_at)
     VALUES ('aa', ?, 'Ada Agency', 'score', 3, 4, 1, 0, 1), ('bb', 'someone-else', 'Other', 'score', 4, 4, 0, 0, 1)`,
  ).bind(user.accountId).run();
  await env.LUMINARA_KV!.put(`sub:${user.accountId}`, '{"plan":"starter"}');
}

function post(body: unknown) {
  return new Request('https://www.luminarasuite.com/api/privacy/account', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('account summary copy', () => {
  it('states the free allowance and the 30 day term', () => {
    expect(checksLeftLine(2, 3, false)).toBe('2 of 3 checks left');
    expect(checksLeftLine(0, 3, true)).toBe('No daily cap on this plan.');
    expect(planTitle('growth')).toBe('Growth');
    expect(planDetailLine('free')).toBe('Free plan. No renewal.');
    expect(planDetailLine('starter', Date.UTC(2026, 9, 22))).toContain('30 days');
    expect(planDetailLine('starter', Date.UTC(2026, 9, 22))).toContain('does not renew');
  });
});

describe('account deletion', () => {
  beforeEach(() => {
    verifyFirebaseIdToken.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  });

  it('refuses a delete that is not signed in again', async () => {
    const { deleteHostedAccount, authTimeIsRecent } = await import('../worker/accountDeletion');
    const env = envOf();
    await seed(env);
    const now = Math.floor(Date.now() / 1000);
    expect(authTimeIsRecent(now - 301, now)).toBe(false);
    expect(authTimeIsRecent(now - 10, now)).toBe(true);
    verifyFirebaseIdToken.mockResolvedValue({
      ok: true,
      user: { uid: 'abc' },
      payload: { auth_time: now - 301 },
    });
    const stale = await deleteHostedAccount(post({ confirm: 'DELETE', idToken: 'stale' }), env, user);
    expect(stale.status).toBe(401);
    const missing = await deleteHostedAccount(post({ confirm: 'DELETE' }), env, user);
    expect(missing.status).toBe(401);
    const untyped = await deleteHostedAccount(post({ confirm: 'delete', idToken: 'fresh' }), env, user);
    expect(untyped.status).toBe(400);
    const left = await env.DB!.prepare(`SELECT COUNT(*) AS n FROM win_shares WHERE owner_id = ?`).bind(user.accountId).first<{ n: number }>();
    expect(left?.n).toBe(1);
  });

  it('deletes the account rows, the public win, and does not log the email', async () => {
    const { deleteHostedAccount } = await import('../worker/accountDeletion');
    const env = envOf();
    await seed(env);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    verifyFirebaseIdToken.mockResolvedValue({
      ok: true,
      user: { uid: 'abc' },
      payload: { auth_time: Math.floor(Date.now() / 1000) },
    });
    const res = await deleteHostedAccount(post({ confirm: 'DELETE', idToken: 'fresh-token' }), env, user);
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; firebaseDeleted: boolean; rows: number };
    expect(body.ok).toBe(true);
    expect(body.firebaseDeleted).toBe(true);
    expect(body.rows).toBeGreaterThan(0);
    expect(await env.DB!.prepare(`SELECT COUNT(*) AS n FROM audit_runs WHERE account_id = ?`).bind(user.accountId).first<{ n: number }>()).toEqual({ n: 0 });
    expect(await env.DB!.prepare(`SELECT COUNT(*) AS n FROM audit_findings WHERE account_id = ?`).bind(user.accountId).first<{ n: number }>()).toEqual({ n: 0 });
    expect(await env.DB!.prepare(`SELECT COUNT(*) AS n FROM user_workspace WHERE account_id = ?`).bind(user.accountId).first<{ n: number }>()).toEqual({ n: 0 });
    expect(await env.DB!.prepare(`SELECT COUNT(*) AS n FROM users WHERE account_id = ?`).bind(user.accountId).first<{ n: number }>()).toEqual({ n: 0 });
    const wins = await env.DB!.prepare(`SELECT id FROM win_shares`).all<{ id: string }>();
    expect(wins.results).toEqual([{ id: 'bb' }]);
    expect(await env.LUMINARA_KV!.get(`sub:${user.accountId}`)).toBeNull();
    const logged = warn.mock.calls.map((call) => String(call[0])).join('\n');
    expect(logged).toContain('"event":"account_deleted"');
    expect(logged).not.toContain('ada@example.com');
    expect(logged).not.toContain('acct1');
    expect(logged).not.toContain('fresh-token');
    warn.mockRestore();
  });
});
