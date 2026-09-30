import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

const firebaseGate = vi.hoisted(() => ({
  token: 'valid-firebase-token',
  uid: 'uid-web',
  email: 'owner@example.com',
  name: 'Owner',
}));

vi.mock('../worker/firebaseAuth', async () => {
  const actual = await vi.importActual<typeof import('../worker/firebaseAuth')>('../worker/firebaseAuth');
  return {
    ...actual,
    verifyFirebaseIdToken: vi.fn(async (idToken: string, projectId: string) => {
      if (!projectId.trim()) return { ok: false as const, reason: 'FIREBASE_PROJECT_ID not configured' };
      if (idToken !== firebaseGate.token) return { ok: false as const, reason: 'Firebase token invalid' };
      return {
        ok: true as const,
        user: {
          uid: firebaseGate.uid,
          email: firebaseGate.email,
          name: firebaseGate.name,
        },
        payload: {},
      };
    }),
  };
});

import worker from '../worker/index';
import type { Env } from '../worker/index';
import { identify } from '../worker/workerUtils';
import { linkTelegramFirebaseAccounts } from '../services/apiClient';
import { createSqliteD1, type SqliteD1 } from './helpers/sqliteD1';

const botToken = '123456:ACCOUNT_LINK_TEST';

function signInitData(userId: number, firstName: string): string {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: firstName }),
  };
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const p = new URLSearchParams(fields);
  p.set('hash', hash);
  return p.toString();
}

function mockKv(store = new Map<string, string>()) {
  return {
    store,
    kv: {
      get: async (key: string, type?: string) => {
        const v = store.get(key);
        if (v === undefined) return null;
        return type === 'json' ? JSON.parse(v) : v;
      },
      put: async (key: string, value: string) => { store.set(key, value); },
      delete: async (key: string) => { store.delete(key); },
      list: async () => ({ keys: [] as { name: string }[], list_complete: true, cacheStatus: null }),
    } as unknown as KVNamespace,
  };
}

function subSnapshot(store: Map<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of store) {
    if (key.startsWith('sub:')) out[key] = value;
  }
  return out;
}

async function seedPair(opts: {
  tgId: string;
  tgAccount: string;
  fbAccount: string;
  tgCreated?: number;
  fbCreated?: number;
  tgSub?: boolean;
  fbSub?: boolean;
}) {
  const db = createSqliteD1();
  const store = new Map<string, string>();
  const seen = 1_700_000_000_000;
  const future = Date.now() + 86_400_000;
  await db.prepare(
    `INSERT INTO users (id, source, email, display_name, telegram_id, firebase_uid, created_at, last_seen_at, account_id)
     VALUES (?, 'telegram', NULL, 'Ada', ?, NULL, ?, ?, ?)`,
  ).bind(opts.tgId, opts.tgId, opts.tgCreated ?? 1_000, seen, opts.tgAccount).run();
  await db.prepare(
    `INSERT INTO users (id, source, email, display_name, telegram_id, firebase_uid, created_at, last_seen_at, account_id)
     VALUES (?, 'firebase', ?, 'Owner', NULL, ?, ?, ?, ?)`,
  ).bind(
    `fb:${firebaseGate.uid}`,
    firebaseGate.email,
    firebaseGate.uid,
    opts.fbCreated ?? 2_000,
    seen,
    opts.fbAccount,
  ).run();
  if (opts.tgSub) store.set(`sub:${opts.tgAccount}`, JSON.stringify({ plan: 'starter', expiresAt: future }));
  if (opts.fbSub) store.set(`sub:${opts.fbAccount}`, JSON.stringify({ plan: 'growth', expiresAt: future }));
  const { kv } = mockKv(store);
  const env = {
    ASSETS: { fetch: async () => new Response('ok') },
    LUMINARA_KV: kv,
    DB: db,
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    BOT_TOKEN: botToken,
    FIREBASE_PROJECT_ID: 'demo-luminara',
  } as Env;
  return { env, db, store };
}

async function accountOf(db: SqliteD1, id: string): Promise<{ account_id: string; last_seen_at: number } | null> {
  return db.prepare(`SELECT account_id, last_seen_at FROM users WHERE id = ?`).bind(id).first<{
    account_id: string;
    last_seen_at: number;
  }>();
}

const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function linkRequest(tgId: number, body: string | null, ip: string, extraHeaders: Record<string, string> = {}) {
  const headers = new Headers({
    'cf-connecting-ip': ip,
    'x-telegram-init-data': signInitData(tgId, 'Ada'),
    authorization: `Bearer ${firebaseGate.token}`,
    ...extraHeaders,
  });
  if (body !== null) headers.set('content-type', 'application/json');
  return new Request('https://luminarasuite.com/api/auth/link', {
    method: 'POST',
    headers,
    body: body ?? undefined,
  });
}

describe('identify() does not auto-link', () => {
  it('leaves both account ids and sub keys unchanged when Bearer and initData are both present', async () => {
    const { env, db, store } = await seedPair({
      tgId: '88001',
      tgAccount: 'acct-tg',
      fbAccount: 'acct-fb',
      tgSub: true,
      fbSub: true,
    });
    const subsBefore = subSnapshot(store);
    const who = await identify(new Request('https://luminarasuite.com/api/auth/session', {
      headers: {
        'x-telegram-init-data': signInitData(88001, 'Ada'),
        authorization: `Bearer ${firebaseGate.token}`,
      },
    }), env);

    expect(who.error).toBeUndefined();
    expect(who.user?.id).toBe('88001');
    expect(who.user?.source).toBe('telegram');
    expect(who.user?.accountId).toBe('acct-tg');
    expect((await accountOf(db, '88001'))?.account_id).toBe('acct-tg');
    expect((await accountOf(db, 'fb:uid-web'))?.account_id).toBe('acct-fb');
    expect(subSnapshot(store)).toEqual(subsBefore);
  });

  it('leaves both account ids unchanged when __session and initData are both present', async () => {
    const { env, db, store } = await seedPair({
      tgId: '88002',
      tgAccount: 'acct-tg-cookie',
      fbAccount: 'acct-fb-cookie',
      tgSub: true,
      fbSub: true,
    });
    const subsBefore = subSnapshot(store);
    const who = await identify(new Request('https://luminarasuite.com/api/workspace', {
      method: 'GET',
      headers: {
        'x-telegram-init-data': signInitData(88002, 'Ada'),
        cookie: `__session=${firebaseGate.token}`,
      },
    }), env);

    expect(who.user?.accountId).toBe('acct-tg-cookie');
    expect((await accountOf(db, '88002'))?.account_id).toBe('acct-tg-cookie');
    expect((await accountOf(db, 'fb:uid-web'))?.account_id).toBe('acct-fb-cookie');
    expect(subSnapshot(store)).toEqual(subsBefore);
  });
});

describe('POST /api/auth/link', () => {
  it('returns 400 and does not merge when confirm is missing or not strictly true', async () => {
    const bodies: Array<string | null> = [null, JSON.stringify({ confirm: false }), JSON.stringify({ confirm: 'true' })];
    for (const [index, body] of bodies.entries()) {
      const { env, db, store } = await seedPair({
        tgId: '88011',
        tgAccount: 'acct-tg',
        fbAccount: 'acct-fb',
        tgSub: true,
        fbSub: false,
      });
      const subsBefore = subSnapshot(store);
      const beforeTg = await accountOf(db, '88011');
      const beforeFb = await accountOf(db, 'fb:uid-web');
      const res = await worker.fetch(linkRequest(88011, body, `10.8.0.${index + 1}`), env, ctx);
      expect(res.status).toBe(400);
      const data = await res.json() as { ok: boolean; code?: string };
      expect(data.ok).toBe(false);
      expect(data.code).toBe('CONFIRM_REQUIRED');
      expect(await accountOf(db, '88011')).toEqual(beforeTg);
      expect(await accountOf(db, 'fb:uid-web')).toEqual(beforeFb);
      expect(subSnapshot(store)).toEqual(subsBefore);
      const audits = await db.prepare(`SELECT action FROM org_audit_logs`).all<{ action: string }>();
      expect(audits.results || []).toHaveLength(0);
    }
  });

  it('merges onto one accountId when confirm is true', async () => {
    const { env, db } = await seedPair({
      tgId: '88021',
      tgAccount: 'acct-tg',
      fbAccount: 'acct-fb',
      tgCreated: 1_000,
      fbCreated: 5_000,
    });
    const res = await worker.fetch(
      linkRequest(88021, JSON.stringify({ confirm: true }), '10.8.1.1'),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean; accountId: string };
    expect(data.ok).toBe(true);
    expect(data.accountId).toBe('acct-tg');
    expect((await accountOf(db, '88021'))?.account_id).toBe('acct-tg');
    expect((await accountOf(db, 'fb:uid-web'))?.account_id).toBe('acct-tg');
    const audits = await db.prepare(`SELECT action, target_id FROM org_audit_logs`).all<{ action: string; target_id: string }>();
    expect(audits.results?.map((row) => row.action)).toEqual(['account.link']);
    expect(audits.results?.[0]?.target_id).toBe('acct-tg');
  });

  it('merges onto the paid account when only one side is paid', async () => {
    const { env, db } = await seedPair({
      tgId: '88031',
      tgAccount: 'acct-tg',
      fbAccount: 'acct-fb',
      fbSub: true,
    });
    const res = await worker.fetch(
      linkRequest(88031, JSON.stringify({ confirm: true }), '10.8.1.2'),
      env,
      ctx,
    );
    expect(res.status).toBe(200);
    const data = await res.json() as { ok: boolean; accountId: string };
    expect(data.accountId).toBe('acct-fb');
    expect((await accountOf(db, '88031'))?.account_id).toBe('acct-fb');
    expect((await accountOf(db, 'fb:uid-web'))?.account_id).toBe('acct-fb');
  });

  it('refuses when both sides have distinct active paid plans', async () => {
    const { env, db, store } = await seedPair({
      tgId: '88041',
      tgAccount: 'acct-tg',
      fbAccount: 'acct-fb',
      tgSub: true,
      fbSub: true,
    });
    const subsBefore = subSnapshot(store);
    const beforeTg = await accountOf(db, '88041');
    const beforeFb = await accountOf(db, 'fb:uid-web');
    const res = await worker.fetch(
      linkRequest(88041, JSON.stringify({ confirm: true }), '10.8.1.3'),
      env,
      ctx,
    );
    expect(res.status).toBe(409);
    const data = await res.json() as { ok: boolean; code?: string };
    expect(data.ok).toBe(false);
    expect(data.code).toBe('DUAL_PAID');
    expect(await accountOf(db, '88041')).toEqual(beforeTg);
    expect(await accountOf(db, 'fb:uid-web')).toEqual(beforeFb);
    expect(subSnapshot(store)).toEqual(subsBefore);
    const audits = await db.prepare(`SELECT action, details FROM org_audit_logs`).all<{ action: string; details: string }>();
    expect(audits.results).toHaveLength(1);
    expect(audits.results?.[0]?.action).toBe('account.link.refused');
    expect(audits.results?.[0]?.details).toContain('dual_paid');
  });
});

describe('linkTelegramFirebaseAccounts', () => {
  it('does not call the worker unless confirm is strictly true', async () => {
    const denied = await linkTelegramFirebaseAccounts();
    expect(denied.ok).toBe(false);
    expect(denied.error).toMatch(/Confirm/);
    const stringConfirm = await linkTelegramFirebaseAccounts({ confirm: false });
    expect(stringConfirm.ok).toBe(false);
  });
});
