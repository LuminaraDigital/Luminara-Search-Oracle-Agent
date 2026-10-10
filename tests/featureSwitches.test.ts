import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../worker/env';
import { handleIdeaScoutRoute } from '../worker/ideaScout';
import { handleReferralRoute } from '../worker/referrals';
import { DailyStreakCard } from '../components/retention/DailyStreakCard';
import { parseJsonc } from '../scripts/lib/jsonc.mjs';
import { createSqliteD1, type SqliteD1 } from './helpers/sqliteD1';

/**
 * Track SW, SW0a-9 (first step) and SW0a-10: two switches, off in every environment.
 * Off, the community feed routes and the daily check-in do not exist; nothing stored is deleted.
 */

const TOKEN = '123456:MOCK_TOKEN';

function memoryKv() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string, type?: string) {
      const val = store.get(key);
      if (val == null) return null;
      return type === 'json' ? JSON.parse(val) : val;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function makeEnv(flags: Partial<Pick<Env, 'COMMUNITY_FEED_ENABLED' | 'LUMENS_ENABLED'>> = {}) {
  const kv = memoryKv();
  const db = createSqliteD1();
  const env = {
    ASSETS: {} as Env['ASSETS'],
    DB: db as D1Database,
    LUMINARA_KV: kv as unknown as KVNamespace,
    FREE_DAILY_LIMIT: '10',
    REQUIRE_TG_AUTH: 'true',
    WEBAPP_URL: 'https://luminarasuite.com',
    BOT_TOKEN: TOKEN,
    ...flags,
  } as Env;
  return { env, kv, db: db as SqliteD1 };
}

function authHeaders(id = 8888): Record<string, string> {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: 'Builder', username: 'builder' }),
  };
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const params = new URLSearchParams(fields);
  params.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
  return { 'content-type': 'application/json', 'x-telegram-init-data': params.toString() };
}

const request = (path: string, method: string, body?: unknown, signedIn = true) =>
  new Request(`https://luminarasuite.com/api${path}`, {
    method,
    headers: signedIn ? authHeaders() : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('the community idea feed switch', () => {
  const routes: Array<[string, string, unknown]> = [
    ['/idea-scout/feed', 'GET', undefined],
    ['/idea-scout/vote', 'POST', { id: 'anything' }],
    ['/idea-scout/share', 'POST', { ideaText: 'An idea', niche: 'saas' }],
  ];

  it.each([undefined, 'false', '', 'TRUE', '1'])('with COMMUNITY_FEED_ENABLED=%s all three feed routes are 404 and nothing is stored', async (value) => {
    const { env, kv } = makeEnv({ COMMUNITY_FEED_ENABLED: value });
    for (const [path, method, body] of routes) {
      for (const signedIn of [true, false]) {
        const res = await handleIdeaScoutRoute(request(path, method, body, signedIn), env, path);
        expect(res.status, `${method} ${path}`).toBe(404);
        expect(await res.json()).toEqual({ ok: false, error: 'Not found', code: 'NOT_FOUND' });
      }
    }
    expect(kv.store.has('idea_scout:community_feed')).toBe(false);
  });

  it('a feed already stored is neither served nor deleted while the switch is off', async () => {
    const { env, kv } = makeEnv();
    const stored = JSON.stringify([{ id: 'card_1', ideaText: 'x', accountId: 'acct_private', upvotes: 3 }]);
    kv.store.set('idea_scout:community_feed', stored);
    const res = await handleIdeaScoutRoute(request('/idea-scout/feed', 'GET', undefined, false), env, '/idea-scout/feed');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('acct_private');
    expect(kv.store.get('idea_scout:community_feed')).toBe(stored);
  });

  it('the rest of Idea Scout still answers', async () => {
    const { env } = makeEnv();
    const res = await handleIdeaScoutRoute(request('/idea-scout', 'GET'), env, '/idea-scout');
    expect(res.status).toBe(200);
  });

  it('switched on, the feed answers', async () => {
    const { env } = makeEnv({ COMMUNITY_FEED_ENABLED: 'true' });
    const res = await handleIdeaScoutRoute(request('/idea-scout/feed', 'GET', undefined, false), env, '/idea-scout/feed');
    expect(res.status).toBe(200);
  });
});

describe('the points switch', () => {
  it.each([undefined, 'false', '', 'TRUE', '1'])('with LUMENS_ENABLED=%s the check-in is 404 and writes nothing', async (value) => {
    const { env, kv, db } = makeEnv({ LUMENS_ENABLED: value });
    const res = await handleReferralRoute(request('/referrals/checkin', 'POST', {}), env, '/referrals/checkin');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: 'Not found', code: 'NOT_FOUND' });
    // A guest gets the same answer, not "sign in": the streak card reads 404 as "do not draw me".
    const guest = await handleReferralRoute(request('/referrals/checkin', 'POST', {}, false), env, '/referrals/checkin');
    expect(guest.status).toBe(404);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM referral_rewards').get().n).toBe(0);
    expect([...kv.store.keys()].filter((k) => k.startsWith('checkin:'))).toEqual([]);
  });

  it('the summary has no points field, and still carries the invite and the progression', async () => {
    const { env } = makeEnv();
    const res = await handleReferralRoute(request('/referrals/me', 'GET'), env, '/referrals/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect('lumens' in body).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/lumens|rank/i);
    expect(body.code).toBeTruthy();
    expect(body.progression).toBeTruthy();
  });

  it('points already earned are not deleted by switching off', async () => {
    const { env, db } = makeEnv({ LUMENS_ENABLED: 'true' });
    const earned = await handleReferralRoute(request('/referrals/checkin', 'POST', {}), env, '/referrals/checkin');
    expect(earned.status).toBe(200);
    const before = db.sqlite.prepare('SELECT COUNT(*) AS n FROM referral_rewards').get().n;
    expect(before).toBeGreaterThan(0);

    env.LUMENS_ENABLED = 'false';
    expect((await handleReferralRoute(request('/referrals/checkin', 'POST', {}), env, '/referrals/checkin')).status).toBe(404);
    expect((await handleReferralRoute(request('/referrals/me', 'GET'), env, '/referrals/me')).status).toBe(200);
    expect(db.sqlite.prepare('SELECT COUNT(*) AS n FROM referral_rewards').get().n).toBe(before);
  });

  it('switched on, the summary carries the points', async () => {
    const { env } = makeEnv({ LUMENS_ENABLED: 'true' });
    const body = (await (await handleReferralRoute(request('/referrals/me', 'GET'), env, '/referrals/me')).json()) as Record<string, unknown>;
    expect(body.lumens).toBeTruthy();
  });

  it('the streak card draws nothing until the check-in has answered, so it never appears with points off', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    try {
      expect(renderToStaticMarkup(createElement(DailyStreakCard, { domain: 'example.com' }))).toBe('');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('both switches are off in every environment', () => {
  const wrangler = parseJsonc(readFileSync(resolve(__dirname, '..', 'wrangler.jsonc'), 'utf8')) as any;
  it.each([
    ['top level', () => wrangler.vars],
    ['staging', () => wrangler.env.staging.vars],
    ['production', () => wrangler.env.production.vars],
  ])('%s', (_name, vars) => {
    expect(vars().COMMUNITY_FEED_ENABLED).toBe('false');
    expect(vars().LUMENS_ENABLED).toBe('false');
  });
});
