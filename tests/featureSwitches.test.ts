import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { handleIdeaScoutRoute } from '../worker/ideaScout';
import { handleReferralRoute } from '../worker/referrals';
import { billingId, identify } from '../worker/workerUtils';
import { DailyStreakCard } from '../components/retention/DailyStreakCard';
import { postDailyCheckin, streakCardVisible } from '../services/referrals/referralClient';
import { parseJsonc } from '../scripts/lib/jsonc.mjs';
import { createSqliteD1, type SqliteD1 } from './helpers/sqliteD1';

/**
 * Track SW, SW0a-9 (first step) and SW0a-10: two switches, off in every environment.
 * Off, the community feed routes and the daily check-in do not exist; nothing stored is deleted.
 */

const TOKEN = '123456:MOCK_TOKEN';

// The browser's check-in call, with the network replaced: each test says what the server answers.
const checkin = vi.hoisted(() => ({
  base: 'https://luminarasuite.com',
  calls: [] as string[],
  respond: (async () => new Response('{}')) as () => Promise<Response>,
}));

vi.mock('../services/apiClient', async (original) => ({
  ...(await original<typeof import('../services/apiClient')>()),
  apiBase: () => checkin.base,
  workerFetchWithAuthRetry: async (url: string) => {
    checkin.calls.push(url);
    return checkin.respond();
  },
}));

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

});

describe('whether the streak card is drawn', () => {
  beforeEach(() => {
    checkin.base = 'https://luminarasuite.com';
    checkin.calls.length = 0;
  });

  const serverAnswers = (status: number, body: unknown) => {
    checkin.respond = async () =>
      new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };

  it.each([
    ['the check-in worked', 200, { ok: true, streakDays: 3 }, true],
    ['the check-in was already done today', 200, { ok: true, alreadyCheckedIn: true, streakDays: 3 }, true],
    ['a guest is asked to sign in, so points are on', 401, { ok: false, error: 'Sign in first.', code: 'AUTH_REQUIRED' }, true],
    ['points are off', 404, { ok: false, error: 'Not found', code: 'NOT_FOUND' }, false],
    ['the caller is rate limited', 429, { ok: false, error: 'Too many requests' }, false],
    ['the server fails', 500, { ok: false, error: 'Internal error' }, false],
    ['the server is down and answers with a page', 503, '<html>Service unavailable</html>', false],
    ['the caller is forbidden', 403, { ok: false, error: 'Forbidden' }, false],
    ['a 200 says the check-in did not happen', 200, { ok: false, error: 'Check-in store unavailable' }, false],
  ])('when %s (HTTP %i) the card is drawn: %j -> %s', async (_case, status, body, drawn) => {
    serverAnswers(status, body);
    const result = await postDailyCheckin();
    expect(checkin.calls).toEqual(['https://luminarasuite.com/api/referrals/checkin']);
    expect(result.status).toBe(status);
    expect(streakCardVisible(result)).toBe(drawn);
  });

  it('the check-in call still reports what it reported before', async () => {
    serverAnswers(200, { ok: true, alreadyCheckedIn: true, streakDays: 4 });
    expect(await postDailyCheckin()).toEqual({ ok: true, alreadyCheckedIn: true, streakDays: 4, status: 200 });
    serverAnswers(404, { ok: false, error: 'Not found', code: 'NOT_FOUND' });
    expect(await postDailyCheckin()).toEqual({ ok: false, error: 'Not found', unavailable: true, status: 404 });
    serverAnswers(500, {});
    expect(await postDailyCheckin()).toEqual({ ok: false, error: 'HTTP 500', unavailable: false, status: 500 });
  });

  it('a request that never gets an answer hides the card', async () => {
    checkin.respond = async () => {
      throw new TypeError('Failed to fetch');
    };
    const result = await postDailyCheckin();
    expect(result).toEqual({ ok: false, error: 'Failed to fetch' });
    expect(streakCardVisible(result)).toBe(false);
  });

  it('with no API base nothing is asked and the card is hidden', async () => {
    checkin.base = '';
    const result = await postDailyCheckin();
    expect(checkin.calls).toEqual([]);
    expect(result).toEqual({ ok: false, error: 'API unavailable' });
    expect(streakCardVisible(result)).toBe(false);
  });

  it('the decision itself: only a check-in that worked, or a 401, draws the card', () => {
    expect(streakCardVisible({ ok: true, status: 200 })).toBe(true);
    expect(streakCardVisible({ ok: false, status: 401 })).toBe(true);
    for (const status of [400, 402, 403, 404, 405, 408, 429, 500, 502, 503, 504]) {
      expect(streakCardVisible({ ok: false, status }), String(status)).toBe(false);
    }
    expect(streakCardVisible({ ok: false })).toBe(false);
    expect(streakCardVisible(null)).toBe(false);
    expect(streakCardVisible(undefined)).toBe(false);
  });

  it('the card draws nothing until the check-in has answered', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    try {
      expect(renderToStaticMarkup(createElement(DailyStreakCard, { domain: 'example.com' }))).toBe('');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the card takes its decision from that function, and a call that throws hides it', () => {
    const source = readFileSync(resolve(__dirname, '..', 'components', 'retention', 'DailyStreakCard.tsx'), 'utf8');
    expect(source).toContain('setAvailable(streakCardVisible(res))');
    expect(source.match(/setAvailable\(/g)).toHaveLength(2);
    expect(source).toMatch(/\.catch\(\(\) => \{\s*if \(!unmounted\) setAvailable\(false\);\s*\}\)/);
    expect(source).toContain('if (!available) return null;');
  });
});

describe('the switches through the Worker, with its sign-in guard in front', () => {
  // The handler tests above call the route handlers directly. In the deployed Worker a guard runs
  // first and answers 401 to a guest on every /idea-scout/* route, so a guest there is told to
  // sign in and never reaches the handler's 404. Neither answer carries feed data.
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
  let lastIp = 0;

  function viaWorker(path: string, method: string, body: unknown, signedIn: boolean): Request {
    const headers: Record<string, string> = {
      ...(signedIn ? authHeaders() : { 'content-type': 'application/json' }),
      origin: 'https://luminarasuite.com',
      // One address per request, so the Worker's per-address limiter never answers for the switch.
      'cf-connecting-ip': `10.73.${Math.floor(lastIp / 250)}.${(lastIp++ % 250) + 1}`,
    };
    return new Request(`https://luminarasuite.com/api${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  function workerEnv(flags: Partial<Pick<Env, 'COMMUNITY_FEED_ENABLED' | 'LUMENS_ENABLED'>> = {}) {
    const made = makeEnv(flags);
    Object.assign(made.env, {
      ASSETS: { fetch: async () => new Response('app') },
      WEBAPP_URL: 'https://luminarasuite.com/',
      ALLOWED_ORIGINS: 'https://luminarasuite.com',
    });
    return made;
  }

  const feedRoutes: Array<[string, string, unknown]> = [
    ['/idea-scout/feed', 'GET', undefined],
    ['/idea-scout/vote', 'POST', { id: 'card_1' }],
    ['/idea-scout/share', 'POST', { ideaText: 'An idea', niche: 'saas' }],
  ];
  const storedFeed = JSON.stringify([
    { id: 'card_1', ideaText: 'x', niche: null, card: null, upvotes: 3, sharedAt: 1, accountId: 'acct_private_owner' },
  ]);

  it('feed off: a guest gets 401 or 404, a signed-in user gets 404, and neither answer names an account', async () => {
    const { env, kv } = workerEnv();
    kv.store.set('idea_scout:community_feed', storedFeed);
    const caller = await identify(request('/idea-scout/feed', 'GET'), env);
    const callerAccountId = billingId(caller.user!);
    expect(callerAccountId).toBeTruthy();

    for (const [path, method, body] of feedRoutes) {
      const guest = await worker.fetch(viaWorker(path, method, body, false), env, ctx);
      expect([401, 404], `guest ${method} ${path}`).toContain(guest.status);
      const signedIn = await worker.fetch(viaWorker(path, method, body, true), env, ctx);
      expect(signedIn.status, `signed-in ${method} ${path}`).toBe(404);
      for (const res of [guest, signedIn]) {
        const text = await res.text();
        expect(text).not.toContain('acct_private_owner');
        expect(text).not.toContain(callerAccountId);
        expect(text).not.toMatch(/account_?id|card_1/i);
      }
    }
    expect(kv.store.get('idea_scout:community_feed')).toBe(storedFeed);
  });

  it('feed on: the same signed-in request reaches the feed, so the 404 above is the switch', async () => {
    const { env } = workerEnv({ COMMUNITY_FEED_ENABLED: 'true' });
    const res = await worker.fetch(viaWorker('/idea-scout/feed', 'GET', undefined, true), env, ctx);
    expect(res.status).toBe(200);
  });

  it('points off: the check-in is 404 for a guest and for a signed-in user, so the card is hidden for both', async () => {
    const { env } = workerEnv();
    for (const signedIn of [false, true]) {
      const res = await worker.fetch(viaWorker('/referrals/checkin', 'POST', {}, signedIn), env, ctx);
      expect(res.status, signedIn ? 'signed in' : 'guest').toBe(404);
      expect(streakCardVisible({ ok: false, status: res.status })).toBe(false);
    }
  });

  it('points on: a guest is asked to sign in, which is the one refusal that still draws the card', async () => {
    const { env } = workerEnv({ LUMENS_ENABLED: 'true' });
    const guest = await worker.fetch(viaWorker('/referrals/checkin', 'POST', {}, false), env, ctx);
    expect(guest.status).toBe(401);
    expect(streakCardVisible({ ok: false, status: guest.status })).toBe(true);
    const signedIn = await worker.fetch(viaWorker('/referrals/checkin', 'POST', {}, true), env, ctx);
    expect(signedIn.status).toBe(200);
    expect(((await signedIn.json()) as { ok: boolean }).ok).toBe(true);
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
