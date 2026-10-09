import { createHmac } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createSqliteD1 } from './helpers/sqliteD1';
import { checkHostedQuota } from '../worker/quotaMiddleware';
import { proxyProvider } from '../worker/providerRelay';
import {
  claimReferral,
  completeClientMission,
  ensureReferralCode,
  handleReferralRoute,
  mintScoutReceipt,
  qualifyReferral,
  readRetentionSnapshot,
  referralBonusRemaining,
  tryConsumeReferralCredit,
} from '../worker/referrals';
import { handleTelegramUpdate } from '../worker/telegramBot';
import type { Env } from '../worker/env';
import {
  assessHonestScout,
  attributionDecision,
  generateReferralCode,
  inviteUrlForCode,
  isoWeekKey,
  nextStreakWeeks,
  scoutEvidenceDomain,
  visibilityLevel,
} from '../services/referrals/rules';
import { safePublicHostname } from '../services/security/publicHostname';
import { clearPendingReferral, holdPendingReferral, readPendingReferral } from '../services/referrals/pendingReferral';
import { claimStoredReferral, qualifyHonestScout, shouldClearPendingClaim } from '../services/referrals/referralClient';
import { clearScoutReceipt, noteScoutReceipt } from '../services/referrals/scoutReceiptCapture';

function memoryKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string, type?: string) {
      const val = store.get(key);
      if (val == null) return null;
      if (type === 'json') return JSON.parse(val);
      return val;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function envWithDb(): Env {
  return {
    ASSETS: {} as Env['ASSETS'],
    DB: createSqliteD1(),
    LUMINARA_KV: memoryKv() as unknown as KVNamespace,
    FREE_DAILY_LIMIT: '1',
    REQUIRE_TG_AUTH: 'true',
    WEBAPP_URL: 'https://luminarasuite.com',
    BOT_TOKEN: '123456:MOCK_TOKEN',
  };
}

const honestBody = {
  domain: 'stripe.com',
  measurementStatus: 'measured' as const,
  completed: true,
  evidencePresent: true,
};

async function honestFor(env: Env, accountId: string, extra: Record<string, unknown> = {}) {
  const receipt = await mintScoutReceipt(env, accountId, 'stripe.com');
  return { ...honestBody, ...extra, receipt };
}

describe('referral rules', () => {
  it('rejects self-referral and keeps the first referrer', () => {
    expect(attributionDecision({ referrerAccountId: 'a', referredAccountId: 'a' })).toEqual({
      ok: false,
      status: 'self',
    });
    expect(attributionDecision({
      referrerAccountId: 'a',
      referredAccountId: 'b',
      existingReferrerAccountId: 'c',
    })).toEqual({ ok: false, status: 'already_other' });
    expect(attributionDecision({
      referrerAccountId: 'a',
      referredAccountId: 'b',
      existingReferrerAccountId: 'a',
    })).toEqual({ ok: true, status: 'already' });
    expect(attributionDecision({ referrerAccountId: 'a', referredAccountId: 'b' })).toEqual({
      ok: true,
      status: 'attribute',
    });
  });

  it('accepts only an honest completed scout and refuses score fields', () => {
    expect(assessHonestScout(honestBody, safePublicHostname).ok).toBe(true);
    expect(assessHonestScout({ ...honestBody, evidencePresent: false }, safePublicHostname)).toMatchObject({
      ok: false,
      code: 'NO_EVIDENCE',
    });
    expect(assessHonestScout({ ...honestBody, measurementStatus: 'estimated' }, safePublicHostname)).toMatchObject({
      ok: false,
      code: 'STATUS_NOT_HONEST',
    });
    expect(assessHonestScout({ ...honestBody, citationRatePercent: 45 }, safePublicHostname)).toMatchObject({
      ok: false,
      code: 'SCORE_NOT_ACCEPTED',
    });
    expect(assessHonestScout({ ...honestBody, domain: 'localhost' }, safePublicHostname)).toMatchObject({
      ok: false,
      code: 'BAD_DOMAIN',
    });
    expect(scoutEvidenceDomain({
      providerId: 'firecrawl',
      subPath: '/scrape',
      body: { url: 'https://stripe.com/pricing' },
      hostname: safePublicHostname,
    })).toBe('stripe.com');
    expect(scoutEvidenceDomain({
      providerId: 'tavily',
      subPath: '/search',
      body: { query: 'what is stripe.com' },
      hostname: safePublicHostname,
    })).toBe('stripe.com');
    expect(scoutEvidenceDomain({
      providerId: 'groq',
      subPath: '/chat/completions',
      body: { url: 'https://stripe.com' },
      hostname: safePublicHostname,
    })).toBeNull();
    expect(scoutEvidenceDomain({
      providerId: 'firecrawl',
      subPath: '/scrape',
      body: { url: 'http://localhost/admin' },
      hostname: safePublicHostname,
    })).toBeNull();
  });

  it('maps Visibility Level to real progress and builds an invite link', () => {
    expect(visibilityLevel({ honestScoutCount: 0, missionsCompleted: 0, streakWeeks: 0 })).toBe('explorer');
    expect(visibilityLevel({ honestScoutCount: 1, missionsCompleted: 0, streakWeeks: 0 })).toBe('scout');
    expect(visibilityLevel({ honestScoutCount: 1, missionsCompleted: 1, streakWeeks: 1 })).toBe('builder');
    expect(visibilityLevel({ honestScoutCount: 1, missionsCompleted: 1, streakWeeks: 4 })).toBe('operator');
    expect(visibilityLevel({ honestScoutCount: 0, missionsCompleted: 3, streakWeeks: 4 })).toBe('explorer');

    const monday = isoWeekKey(new Date('2024-01-01T00:00:00Z'));
    const nextMonday = isoWeekKey(new Date('2024-01-08T00:00:00Z'));
    expect(monday).not.toBe(nextMonday);
    expect(nextStreakWeeks(2, monday, monday)).toBe(2);
    expect(nextStreakWeeks(2, monday, nextMonday)).toBe(3);
    expect(nextStreakWeeks(2, '2024-W52', '2025-W01')).toBe(3);
    expect(nextStreakWeeks(2, monday, isoWeekKey(new Date('2024-02-05T00:00:00Z')))).toBe(1);

    const code = generateReferralCode(new Uint8Array(10).fill(0));
    expect(inviteUrlForCode(code)).toBe(`https://t.me/LuminaraSuiteBot/app?startapp=ref_${code}`);
  });

  it('holds a pending ref until the caller clears it', () => {
    const store = new Map<string, string>();
    const memory = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    };
    holdPendingReferral('ref_abcdefghj2', memory);
    expect(readPendingReferral(memory)).toBe('abcdefghj2');
    holdPendingReferral('ref_1234567890', memory);
    expect(readPendingReferral(memory)).toBe('abcdefghj2');
    clearPendingReferral(memory);
    expect(readPendingReferral(memory)).toBeNull();
  });
});

describe('referral ledger', () => {
  it('rejects unauthenticated invite reads', async () => {
    const env = envWithDb();
    const res = await handleReferralRoute(
      new Request('https://luminarasuite.com/api/referrals/me'),
      env,
      '/referrals/me',
    );
    expect(res.status).toBe(401);
  });

  it('attributes once, ignores self-ref, and pays both sides only after a qualifying scout', async () => {
    const env = envWithDb();
    const codeA = await ensureReferralCode(env, 'acct_a');
    const codeC = await ensureReferralCode(env, 'acct_c');

    const self = await claimReferral(env, { accountId: 'acct_a', code: codeA });
    expect(self).toMatchObject({ ok: false, status: 'self' });

    const claimed = await claimReferral(env, { accountId: 'acct_b', code: codeA });
    expect(claimed).toEqual({ ok: true, status: 'attributed' });
    const again = await claimReferral(env, { accountId: 'acct_b', code: codeA });
    expect(again).toEqual({ ok: true, status: 'already' });
    const other = await claimReferral(env, { accountId: 'acct_b', code: codeC });
    expect(other).toMatchObject({ ok: false, status: 'already_other' });

    const empty = await qualifyReferral(env, {
      accountId: 'acct_b',
      body: { ...honestBody, measurementStatus: 'not_measured', evidencePresent: false },
    });
    expect(empty.ok).toBe(false);
    expect(await referralBonusRemaining(env, 'acct_a')).toBe(0);
    expect(await referralBonusRemaining(env, 'acct_b')).toBe(0);

    const scored = await qualifyReferral(env, {
      accountId: 'acct_b',
      body: { ...honestBody, citationRatePercent: 12 },
    });
    expect(scored).toMatchObject({ ok: false, code: 'SCORE_NOT_ACCEPTED' });

    const forged = await qualifyReferral(env, { accountId: 'acct_b', body: honestBody });
    expect(forged).toMatchObject({ ok: false, code: 'NO_RECEIPT' });
    expect(await referralBonusRemaining(env, 'acct_a')).toBe(0);

    const granted = await qualifyReferral(env, { accountId: 'acct_b', body: await honestFor(env, 'acct_b') });
    expect(granted).toMatchObject({ ok: true, rewardsGranted: true, reason: 'granted' });
    expect(await referralBonusRemaining(env, 'acct_a')).toBe(2);
    expect(await referralBonusRemaining(env, 'acct_b')).toBe(2);

    const repeat = await qualifyReferral(env, { accountId: 'acct_b', body: await honestFor(env, 'acct_b') });
    expect(repeat).toMatchObject({ ok: true, rewardsGranted: false });
    expect(await referralBonusRemaining(env, 'acct_a')).toBe(2);
    expect(await referralBonusRemaining(env, 'acct_b')).toBe(2);

    const snap = await readRetentionSnapshot(env, 'acct_b', codeA);
    expect(snap.progression.visibilityLevel).toBe('builder');
    expect(snap.missions.find((mission) => mission.key === 'rescout')?.status).toBe('completed');
    expect(snap.inviteUrl).toContain('startapp=ref_');
  });

  it('does not let the client complete the re-scout mission directly', async () => {
    const env = envWithDb();
    const blocked = await completeClientMission(env, { accountId: 'acct_b', missionKey: 'rescout' });
    expect(blocked.ok).toBe(false);
    const viewed = await completeClientMission(env, { accountId: 'acct_b', missionKey: 'view_delta' });
    expect(viewed).toEqual({ ok: true, created: true });
    const snap = await readRetentionSnapshot(env, 'acct_b');
    expect(snap.progression.visibilityLevel).toBe('explorer');
    expect(snap.missions.find((mission) => mission.key === 'view_delta')?.status).toBe('completed');
  });

  it('rolls back both credits when the referred insert fails, then a later qualify pays both sides', async () => {
    const env = envWithDb();
    const codeA = await ensureReferralCode(env, 'acct_a');
    await claimReferral(env, { accountId: 'acct_b', code: codeA });
    await env.DB!.exec(`
      CREATE TRIGGER fail_referred_credit
      BEFORE INSERT ON referral_rewards
      WHEN NEW.reason LIKE '%:referred'
      BEGIN
        SELECT RAISE(ABORT, 'referred credit failed');
      END;
    `);

    const failed = await qualifyReferral(env, { accountId: 'acct_b', body: await honestFor(env, 'acct_b') });
    expect(failed).toMatchObject({ ok: false, code: 'GRANT_FAILED' });
    const stuck = await env.DB!.prepare(
      `SELECT qualified_at FROM referral_attributions WHERE referred_account_id = ?`,
    ).bind('acct_b').first<{ qualified_at: number | null }>();
    expect(stuck?.qualified_at ?? null).toBeNull();
    expect(await referralBonusRemaining(env, 'acct_a')).toBe(0);
    expect(await referralBonusRemaining(env, 'acct_b')).toBe(0);

    await env.DB!.exec('DROP TRIGGER fail_referred_credit');
    const retried = await qualifyReferral(env, { accountId: 'acct_b', body: await honestFor(env, 'acct_b') });
    expect(retried).toMatchObject({ ok: true, rewardsGranted: true, reason: 'granted' });
    expect(await referralBonusRemaining(env, 'acct_a')).toBe(2);
    expect(await referralBonusRemaining(env, 'acct_b')).toBe(2);
  });

  it('finishes a one-sided ledger row without leaving the attribution unqualified', async () => {
    const env = envWithDb();
    const codeA = await ensureReferralCode(env, 'acct_a');
    await claimReferral(env, { accountId: 'acct_b', code: codeA });
    const now = Date.now();
    await env.DB!.prepare(
      `INSERT INTO referral_rewards (id, account_id, kind, amount, remaining, reason, created_at)
       VALUES ('rwd_partial', 'acct_a', 'hosted_scout_credit', 2, 2, 'qualified:acct_b:referrer', ?)`,
    ).bind(now).run();

    const granted = await qualifyReferral(env, { accountId: 'acct_b', body: await honestFor(env, 'acct_b') });
    expect(granted).toMatchObject({ ok: true, rewardsGranted: true });
    expect(await referralBonusRemaining(env, 'acct_a')).toBe(2);
    expect(await referralBonusRemaining(env, 'acct_b')).toBe(2);
    const row = await env.DB!.prepare(
      `SELECT qualified_at FROM referral_attributions WHERE referred_account_id = ?`,
    ).bind('acct_b').first<{ qualified_at: number | null }>();
    expect(row?.qualified_at).toBeTruthy();
  });

  it('spends referral credits only after the daily cap, and never for anonymous or unlimited plans', async () => {
    const env = envWithDb();
    const codeA = await ensureReferralCode(env, 'acct_a');
    await claimReferral(env, { accountId: 'acct_b', code: codeA });
    await qualifyReferral(env, { accountId: 'acct_b', body: await honestFor(env, 'acct_b') });

    const user = { id: 'acct_b', source: 'telegram' as const, accountId: 'acct_b' };
    const first = await checkHostedQuota(env, user);
    expect(first.ok).toBe(true);
    expect(first.bonusConsumed).toBeUndefined();
    expect(first.bonusRemaining).toBe(2);

    const second = await checkHostedQuota(env, user);
    expect(second.ok).toBe(true);
    expect(second.bonusConsumed).toBe(true);
    expect(second.bonusRemaining).toBe(1);

    const third = await checkHostedQuota(env, user);
    expect(third.bonusConsumed).toBe(true);
    expect(third.bonusRemaining).toBe(0);

    const fourth = await checkHostedQuota(env, user);
    expect(fourth.ok).toBe(false);
    expect(await referralBonusRemaining(env, 'acct_b')).toBe(0);
    expect(await referralBonusRemaining(env, 'acct_a')).toBe(2);

    const anonEnv = envWithDb();
    anonEnv.REQUIRE_TG_AUTH = 'false';
    await anonEnv.DB!.prepare(
      `INSERT INTO referral_rewards (id, account_id, kind, amount, remaining, reason, created_at)
       VALUES ('rwd_test', 'acct_keep', 'hosted_scout_credit', 2, 2, 'qualified:test:referred', ?)`,
    ).bind(Date.now()).run();
    const anon1 = await checkHostedQuota(anonEnv, null, { clientIp: '203.0.113.10' });
    const anon2 = await checkHostedQuota(anonEnv, null, { clientIp: '203.0.113.10' });
    expect(anon1.ok).toBe(true);
    expect(anon2.ok).toBe(false);
    expect(await referralBonusRemaining(anonEnv, 'acct_keep')).toBe(2);

    const paid = envWithDb();
    await paid.LUMINARA_KV!.put('sub:acct_b', JSON.stringify({ plan: 'starter', expiresAt: Date.now() + 86_400_000 }));
    await paid.DB!.prepare(
      `INSERT INTO referral_rewards (id, account_id, kind, amount, remaining, reason, created_at)
       VALUES ('rwd_paid', 'acct_b', 'hosted_scout_credit', 2, 2, 'qualified:acct_b:referred', ?)`,
    ).bind(Date.now()).run();
    const unlimited = await checkHostedQuota(paid, user);
    expect(unlimited.isUnlimited).toBe(true);
    expect(await referralBonusRemaining(paid, 'acct_b')).toBe(2);
  });

  it('does not finish re-scout on the first honest scout of a new week when lifetime count is already past 2', async () => {
    const env = envWithDb();
    const now = Date.now();
    await env.DB!.prepare(
      `INSERT INTO user_progression (
         account_id, streak_weeks, last_mission_week, last_mission_at, visibility_level,
         honest_scout_count, last_honest_scout_day, week_scout_key, week_scout_count, updated_at
       ) VALUES ('acct_b', 2, '1999-W01', ?, 'builder', 4, '2000-01-01', '1999-W01', 9, ?)`,
    ).bind(now, now).run();

    const first = await qualifyReferral(env, { accountId: 'acct_b', body: await honestFor(env, 'acct_b') });
    expect(first).toMatchObject({ ok: true, rewardsGranted: false, reason: 'no_attribution' });
    const mid = await readRetentionSnapshot(env, 'acct_b');
    expect(mid.missions.find((mission) => mission.key === 'rescout')?.status).toBe('open');
    expect(mid.progression.honestScoutCount).toBe(5);

    const second = await qualifyReferral(env, { accountId: 'acct_b', body: await honestFor(env, 'acct_b') });
    expect(second.ok).toBe(true);
    const done = await readRetentionSnapshot(env, 'acct_b');
    expect(done.missions.find((mission) => mission.key === 'rescout')?.status).toBe('completed');
  });

  it('rejects a replayed receipt and a receipt for another account', async () => {
    const env = envWithDb();
    const receipt = await mintScoutReceipt(env, 'acct_b', 'stripe.com');
    const first = await qualifyReferral(env, { accountId: 'acct_b', body: { ...honestBody, receipt } });
    expect(first.ok).toBe(true);
    const replay = await qualifyReferral(env, { accountId: 'acct_b', body: { ...honestBody, receipt } });
    expect(replay).toMatchObject({ ok: false, code: 'RECEIPT_REJECTED' });

    const other = await mintScoutReceipt(env, 'acct_a', 'stripe.com');
    const stolen = await qualifyReferral(env, { accountId: 'acct_b', body: { ...honestBody, receipt: other } });
    expect(stolen).toMatchObject({ ok: false, code: 'RECEIPT_REJECTED' });

    const wrongHost = await mintScoutReceipt(env, 'acct_b', 'cloudflare.com');
    const mismatch = await qualifyReferral(env, { accountId: 'acct_b', body: { ...honestBody, receipt: wrongHost } });
    expect(mismatch).toMatchObject({ ok: false, code: 'RECEIPT_REJECTED' });
  });

  it('lets only one of two concurrent consumes take the last credit', async () => {
    const env = envWithDb();
    await env.DB!.prepare(
      `INSERT INTO referral_rewards (id, account_id, kind, amount, remaining, reason, created_at)
       VALUES ('rwd_race', 'acct_b', 'hosted_scout_credit', 1, 1, 'qualified:race:referred', ?)`,
    ).bind(Date.now()).run();

    const [a, b] = await Promise.all([
      tryConsumeReferralCredit(env, 'acct_b'),
      tryConsumeReferralCredit(env, 'acct_b'),
    ]);
    const wins = [a, b].filter((result) => result.ok);
    expect(wins).toHaveLength(1);
    expect(await referralBonusRemaining(env, 'acct_b')).toBe(0);

    await env.DB!.prepare(
      `INSERT INTO referral_rewards (id, account_id, kind, amount, remaining, reason, created_at)
       VALUES ('rwd_two', 'acct_c', 'hosted_scout_credit', 2, 2, 'qualified:two:referred', ?)`,
    ).bind(Date.now()).run();
    const pair = await Promise.all([
      tryConsumeReferralCredit(env, 'acct_c'),
      tryConsumeReferralCredit(env, 'acct_c'),
    ]);
    expect(pair.filter((result) => result.ok)).toHaveLength(2);
    expect(await referralBonusRemaining(env, 'acct_c')).toBe(0);
  });

  it('mints a scout receipt on signed-in Firecrawl scrape and not on chat', async () => {
    const env = envWithDb();
    env.FREE_DAILY_LIMIT = '10';
    env.FIRECRAWL_API_KEY = 'fc_hosted';
    env.GROQ_API_KEY = 'gsk_hosted';
    const initData = signInitData({
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 4242, first_name: 'Scout' }),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === 'string' ? input : 'url' in input ? (input as any).url : String(input);
      if (urlStr.includes('cloudflare-dns.com')) {
        return new Response(JSON.stringify({ Status: 0, Answer: [{ type: 1, data: '93.184.216.34' }] }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        });
      }
      return new Response(JSON.stringify({ data: { markdown: '# Stripe' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as any;
    try {
      const scrape = await proxyProvider(
        new Request('https://luminarasuite.com/api/providers/firecrawl/scrape', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
          body: JSON.stringify({ url: 'https://stripe.com' }),
        }),
        env,
        'firecrawl',
        '/scrape',
      );
      expect(scrape.status).toBe(200);
      const receipt = scrape.headers.get('x-scout-receipt');
      expect(receipt).toMatch(/^[a-f0-9]{64}$/);

      const chat = await proxyProvider(
        new Request('https://luminarasuite.com/api/providers/groq/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData },
          body: JSON.stringify({ model: 'llama', messages: [{ role: 'user', content: 'https://stripe.com' }] }),
        }),
        env,
        'groq',
        '/chat/completions',
      );
      expect(chat.status).toBe(200);
      expect(chat.headers.get('x-scout-receipt')).toBeNull();

      const qualified = await qualifyReferral(env, {
        accountId: '4242',
        body: { ...honestBody, receipt },
      });
      expect(qualified).toMatchObject({ ok: true, reason: 'no_attribution' });
      const replay = await qualifyReferral(env, {
        accountId: '4242',
        body: { ...honestBody, receipt },
      });
      expect(replay).toMatchObject({ ok: false, code: 'RECEIPT_REJECTED' });

      const byok = await proxyProvider(
        new Request('https://luminarasuite.com/api/providers/firecrawl/scrape', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-provider-key': 'fc_user',
          },
          body: JSON.stringify({ url: 'https://stripe.com' }),
        }),
        env,
        'firecrawl',
        '/scrape',
      );
      expect(byok.headers.get('x-scout-receipt')).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function signInitData(fields: Record<string, string>, token = '123456:MOCK_TOKEN'): string {
  const dcs = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

describe('pending invite claim', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears only a final claim result', () => {
    expect(shouldClearPendingClaim(200, 'attributed')).toBe(true);
    expect(shouldClearPendingClaim(200, 'already')).toBe(true);
    expect(shouldClearPendingClaim(400, 'self')).toBe(true);
    expect(shouldClearPendingClaim(400, 'invalid')).toBe(true);
    expect(shouldClearPendingClaim(409, 'already_other')).toBe(true);
    expect(shouldClearPendingClaim(401, 'self')).toBe(false);
    expect(shouldClearPendingClaim(403, 'invalid')).toBe(false);
    expect(shouldClearPendingClaim(429, 'invalid')).toBe(false);
    expect(shouldClearPendingClaim(503, 'attributed')).toBe(false);
    expect(shouldClearPendingClaim(500, 'attributed')).toBe(false);
    expect(shouldClearPendingClaim(400, undefined)).toBe(false);
    expect(shouldClearPendingClaim(200, undefined)).toBe(false);
  });

  it('keeps the stored code on 401 and drops it on a definitive rejection', async () => {
    const mem = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => { mem.set(key, value); },
      removeItem: (key: string) => { mem.delete(key); },
    });
    vi.stubGlobal('window', {
      location: { protocol: 'https:', origin: 'https://luminarasuite.com', search: '' },
      dispatchEvent: () => true,
    });
    holdPendingReferral('ref_abcdefghj2');
    expect(readPendingReferral()).toBe('abcdefghj2');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'Sign in' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })));
    await claimStoredReferral();
    expect(readPendingReferral()).toBe('abcdefghj2');

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, status: 'self', error: 'You cannot use your own invite.' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })));
    await claimStoredReferral();
    expect(readPendingReferral()).toBeNull();
  });

  it('posts the Worker receipt and skips qualify when none was captured', async () => {
    clearScoutReceipt();
    vi.stubGlobal('window', {
      location: { protocol: 'https:', origin: 'https://luminarasuite.com', search: '' },
      dispatchEvent: () => true,
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ rewardsGranted: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const skipped = await qualifyHonestScout({
      domain: 'stripe.com',
      measurementStatus: 'measured',
      completed: true,
      evidencePresent: true,
    });
    expect(skipped).toEqual({ rewardsGranted: false });
    expect(fetchMock).not.toHaveBeenCalled();

    noteScoutReceipt('a'.repeat(64));
    const sent = await qualifyHonestScout({
      domain: 'stripe.com',
      measurementStatus: 'measured',
      completed: true,
      evidencePresent: true,
    });
    expect(sent).toEqual({ rewardsGranted: true });
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.receipt).toBe('a'.repeat(64));
    expect(body.citationRatePercent).toBeUndefined();
  });
});

describe('mission nudge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('answers /missions with one opt-in message and does not loop', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    const env = envWithDb();
    await handleTelegramUpdate(
      { message: { chat: { id: 5 }, from: { id: 5 }, text: '/missions' } },
      env,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.text).toContain('Weekly missions');
    expect(body.text).toContain('does not send a weekly blast');
    expect(body.text).toContain('Explorer');
    expect(body.reply_markup.inline_keyboard[0][0].web_app.url).toContain('startapp=dashboard');
  });
});
