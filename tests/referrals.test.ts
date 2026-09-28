import { describe, expect, it, vi, afterEach } from 'vitest';
import { createSqliteD1 } from './helpers/sqliteD1';
import { checkHostedQuota } from '../worker/quotaMiddleware';
import {
  claimReferral,
  completeClientMission,
  ensureReferralCode,
  handleReferralRoute,
  qualifyReferral,
  readRetentionSnapshot,
  referralBonusRemaining,
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
  visibilityLevel,
} from '../services/referrals/rules';
import { safePublicHostname } from '../services/security/publicHostname';
import { clearPendingReferral, holdPendingReferral, readPendingReferral } from '../services/referrals/pendingReferral';

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

    const granted = await qualifyReferral(env, { accountId: 'acct_b', body: honestBody });
    expect(granted).toMatchObject({ ok: true, rewardsGranted: true, reason: 'granted' });
    expect(await referralBonusRemaining(env, 'acct_a')).toBe(2);
    expect(await referralBonusRemaining(env, 'acct_b')).toBe(2);

    const repeat = await qualifyReferral(env, { accountId: 'acct_b', body: honestBody });
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

  it('spends referral credits only after the daily cap, and never for anonymous or unlimited plans', async () => {
    const env = envWithDb();
    const codeA = await ensureReferralCode(env, 'acct_a');
    await claimReferral(env, { accountId: 'acct_b', code: codeA });
    await qualifyReferral(env, { accountId: 'acct_b', body: honestBody });

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
