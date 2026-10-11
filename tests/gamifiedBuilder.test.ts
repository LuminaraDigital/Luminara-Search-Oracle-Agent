import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';
import {
  calculateLumens,
  type LumensBreakdown,
  type LumensRank,
} from '../services/referrals/rules';
import {
  handleDailyCheckin,
  handleReferralRoute,
  readRetentionSnapshot,
} from '../worker/referrals';
import {
  handleIdeaScoutRoute,
  loadCommunityFeed,
  type CommunityIdeaCard,
} from '../worker/ideaScout';

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
    FREE_DAILY_LIMIT: '10',
    REQUIRE_TG_AUTH: 'true',
    WEBAPP_URL: 'https://luminarasuite.com',
    BOT_TOKEN: '123456:MOCK_TOKEN',
    // These suites describe the features switched on. tests/featureSwitches.test.ts covers them off.
    COMMUNITY_FEED_ENABLED: 'true',
    LUMENS_ENABLED: 'true',
  };
}

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

function authHeaders(id = 8888, username = 'builder'): Record<string, string> {
  const initData = signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: 'Builder', username }),
  });
  return {
    'content-type': 'application/json',
    'x-telegram-init-data': initData,
  };
}

describe('Lumens calculation & rank tiers (Phase 1)', () => {
  it('calculates zero points correctly for a fresh builder', () => {
    const result = calculateLumens({
      honestScoutCount: 0,
      missionsCompleted: 0,
      streakWeeks: 0,
    });

    expect(result).toEqual({
      total: 0,
      rank: 'Bronze',
      nextMilestone: 250,
      honestScoutPoints: 0,
      missionPoints: 0,
      streakPoints: 0,
      bonusCreditPoints: 0,
    });
  });

  it('correctly weights all point factors', () => {
    // 2 scouts * 50 = 100
    // 3 missions * 30 = 90
    // 2 weeks * 200 = 400
    // 1 credit * 100 = 100
    // Total = 690 -> Silver
    const result = calculateLumens({
      honestScoutCount: 2,
      missionsCompleted: 3,
      streakWeeks: 2,
      bonusRemaining: 1,
    });

    expect(result.honestScoutPoints).toBe(100);
    expect(result.missionPoints).toBe(90);
    expect(result.streakPoints).toBe(400);
    expect(result.bonusCreditPoints).toBe(100);
    expect(result.total).toBe(690);
    expect(result.rank).toBe('Silver');
    expect(result.nextMilestone).toBe(750);
  });

  it('verifies exact threshold boundaries for all rank tiers', () => {
    const checkTier = (points: number, expectedRank: LumensRank, expectedNext: number) => {
      // Use streakWeeks * 200 + honestScoutCount * 50 or checkinPoints to dial exact points
      const res = calculateLumens({
        honestScoutCount: 0,
        missionsCompleted: 0,
        streakWeeks: 0,
        checkinPoints: points,
      });
      expect(res.total).toBe(points);
      expect(res.rank).toBe(expectedRank);
      expect(res.nextMilestone).toBe(expectedNext);
    };

    // Bronze: < 250 (nextMilestone: 250)
    checkTier(0, 'Bronze', 250);
    checkTier(249, 'Bronze', 250);

    // Silver: 250 - 749 (nextMilestone: 750)
    checkTier(250, 'Silver', 750);
    checkTier(749, 'Silver', 750);

    // Gold: 750 - 1999 (nextMilestone: 2000)
    checkTier(750, 'Gold', 2000);
    checkTier(1999, 'Gold', 2000);

    // Diamond: 2000 - 4999 (nextMilestone: 5000)
    checkTier(2000, 'Diamond', 5000);
    checkTier(4999, 'Diamond', 5000);

    // Apex: 5000+ (nextMilestone: 10000)
    checkTier(5000, 'Apex', 10000);
    checkTier(12500, 'Apex', 10000);
  });

  it('handles negative or invalid inputs defensively', () => {
    const res = calculateLumens({
      honestScoutCount: -5,
      missionsCompleted: -2,
      streakWeeks: -1,
      bonusRemaining: -3,
    });
    expect(res.total).toBe(0);
    expect(res.rank).toBe('Bronze');
  });
});

describe('Retention snapshot & GET /referrals/me (Phase 1)', () => {
  it('returns Lumens breakdown inside readRetentionSnapshot', async () => {
    const env = envWithDb();
    const accountId = 'user_99';

    // Insert 2 honest scouts, 1 mission completed, 1 streak week, 1 bonus credit
    await env.DB!.prepare(
      `INSERT INTO user_progression (
         account_id, streak_weeks, honest_scout_count, visibility_level, updated_at
       ) VALUES (?, 1, 2, 'builder', ?)`,
    ).bind(accountId, Date.now()).run();

    await env.DB!.prepare(
      `INSERT INTO user_missions (id, account_id, mission_key, week_key, status, created_at, completed_at)
       VALUES ('msn_1', ?, 'view_delta', '2026-W41', 'completed', ?, ?)`,
    ).bind(accountId, Date.now(), Date.now()).run();

    await env.DB!.prepare(
      `INSERT INTO referral_rewards (id, account_id, kind, amount, remaining, reason, created_at)
       VALUES ('rwd_bonus', ?, 'hosted_scout_credit', 1, 1, 'bonus:test', ?)`,
    ).bind(accountId, Date.now()).run();

    const snapshot = await readRetentionSnapshot(env, accountId);
    expect(snapshot.lumens).toBeDefined();
    // 2 * 50 = 100, 1 * 30 = 30, 1 * 200 = 200, 1 * 100 = 100 -> Total: 430
    expect(snapshot.lumens.total).toBe(430);
    expect(snapshot.lumens.honestScoutPoints).toBe(100);
    expect(snapshot.lumens.missionPoints).toBe(30);
    expect(snapshot.lumens.streakPoints).toBe(200);
    expect(snapshot.lumens.bonusCreditPoints).toBe(100);
    expect(snapshot.lumens.rank).toBe('Silver');
    expect(snapshot.lumens.nextMilestone).toBe(750);
  });

  it('serves GET /referrals/me with Lumens breakdown over HTTP route', async () => {
    const env = envWithDb();
    const req = new Request('https://luminarasuite.com/api/referrals/me', {
      method: 'GET',
      headers: authHeaders(4001, 'tester'),
    });

    const res = await handleReferralRoute(req, env, '/referrals/me');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; code: string; lumens: LumensBreakdown };
    expect(body.ok).toBe(true);
    expect(body.code).toBeDefined();
    expect(body.lumens).toBeDefined();
    expect(body.lumens.rank).toBe('Bronze');
    expect(body.lumens.total).toBe(0);
    expect(body.lumens.nextMilestone).toBe(250);
  });
});

describe('Daily check-in endpoint (Phase 1)', () => {
  it('grants 25 Lumens on first check-in of the day and updates progression', async () => {
    const env = envWithDb();
    const req = new Request('https://luminarasuite.com/api/referrals/checkin', {
      method: 'POST',
      headers: authHeaders(5001, 'checker'),
      body: JSON.stringify({}),
    });

    const res = await handleReferralRoute(req, env, '/referrals/checkin');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      alreadyCheckedIn: boolean;
      awardedLumens: number;
      lumens: LumensBreakdown;
    };

    expect(body.ok).toBe(true);
    expect(body.alreadyCheckedIn).toBe(false);
    expect(body.awardedLumens).toBe(25);
    expect(body.lumens.total).toBe(25);
    expect(body.lumens.checkinPoints).toBe(25);

    // Verify reward row in referral_rewards table
    const rewardRow = await env.DB!.prepare(
      `SELECT kind, amount, remaining, reason FROM referral_rewards WHERE account_id = '5001'`,
    ).first<{ kind: string; amount: number; remaining: number; reason: string }>();

    expect(rewardRow).toBeDefined();
    expect(rewardRow?.kind).toBe('daily_checkin');
    expect(rewardRow?.amount).toBe(25);
    expect(rewardRow?.remaining).toBe(25);
    expect(rewardRow?.reason).toMatch(/^checkin:\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects duplicate check-in on the same UTC day', async () => {
    const env = envWithDb();
    const headers = authHeaders(5002, 'double_checker');

    const first = await handleReferralRoute(
      new Request('https://luminarasuite.com/api/referrals/checkin', {
        method: 'POST',
        headers,
      }),
      env,
      '/referrals/checkin',
    );
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { alreadyCheckedIn: boolean; awardedLumens: number };
    expect(firstBody.alreadyCheckedIn).toBe(false);
    expect(firstBody.awardedLumens).toBe(25);

    // Second check-in on same day
    const second = await handleReferralRoute(
      new Request('https://luminarasuite.com/api/referrals/checkin', {
        method: 'POST',
        headers,
      }),
      env,
      '/referrals/checkin',
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      ok: boolean;
      alreadyCheckedIn: boolean;
      awardedLumens?: number;
      lumens: LumensBreakdown;
    };
    expect(secondBody.ok).toBe(true);
    expect(secondBody.alreadyCheckedIn).toBe(true);
    expect(secondBody.awardedLumens).toBeUndefined();
    // Points should stay at 25, not 50
    expect(secondBody.lumens.total).toBe(25);
  });

  it('invokes handleDailyCheckin directly with full idempotence', async () => {
    const env = envWithDb();
    const accountId = 'direct_user_01';

    const check1 = await handleDailyCheckin(env, accountId);
    expect(check1.ok).toBe(true);
    expect(check1.alreadyCheckedIn).toBe(false);
    expect(check1.awardedLumens).toBe(25);
    expect(check1.lumens.total).toBe(25);

    const check2 = await handleDailyCheckin(env, accountId);
    expect(check2.ok).toBe(true);
    expect(check2.alreadyCheckedIn).toBe(true);
    expect(check2.awardedLumens).toBeUndefined();
    expect(check2.lumens.total).toBe(25);
  });

  it('requires signed-in identity for check-in', async () => {
    const env = envWithDb();
    const unauthReq = new Request('https://luminarasuite.com/api/referrals/checkin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    const res = await handleReferralRoute(unauthReq, env, '/referrals/checkin');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('AUTH_REQUIRED');
  });
});

describe('Build in Public Community Feed (Phase 2)', () => {
  it('retrieves public community feed without authentication', async () => {
    const env = envWithDb();
    const req = new Request('https://luminarasuite.com/api/idea-scout/feed', {
      method: 'GET',
    });

    const res = await handleIdeaScoutRoute(req, env, '/idea-scout/feed');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; feed: CommunityIdeaCard[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.feed)).toBe(true);
    expect(body.feed.length).toBeGreaterThanOrEqual(2);

    // Verify honesty guarantees on seed cards
    for (const card of body.feed) {
      expect(card.id).toBeDefined();
      expect(card.ideaText).toBeDefined();
      expect(card.upvotes).toBeGreaterThanOrEqual(0);
      const str = JSON.stringify(card);
      // No percentage theater or em dashes
      expect(str).not.toMatch(/\d+(?:\.\d+)?\s*%/);
      expect(str).not.toContain('\u2014');
    }
  });

  it('allows a founder to publish their Idea Scout card to the feed', async () => {
    const env = envWithDb();
    const accountId = '6001';

    // Store an idea card in DB first
    const cardData = {
      problem: 'Independent mechanics need customer appointment reminders that work via SMS.',
      whoAsksAi: {
        label: 'model_inference',
        persona: 'Auto shop owner',
        promptPatterns: ['simple sms reminder software for auto repair'],
      },
      contentBets: [
        { label: 'hypothesis', hypothesis: 'SMS reminder best practices for independent mechanics.' },
        { label: 'hypothesis', hypothesis: 'No-show reduction benchmarks across repair trades.' },
        { label: 'hypothesis', hypothesis: 'Free downloadable repair estimate templates.' },
      ],
      siteChecklist: [{ key: 'schema', label: 'Schema', status: 'not_measured' }],
      competitorCitation: { status: 'not_measured', competitors: [] },
      fetchStatus: 'not_measured',
    };

    await env.DB!.prepare(
      `INSERT INTO idea_scouts (
         id, account_id, idea_text, niche, competitor_urls_json, card_json, status, created_at
       ) VALUES ('is_mechanic_01', ?, 'SMS appointment reminders for auto repair shops', 'Auto Repair', '[]', ?, 'ready', ?)`,
    ).bind(accountId, JSON.stringify(cardData), Date.now()).run();

    // Share card to community feed
    const shareReq = new Request('https://luminarasuite.com/api/idea-scout/share', {
      method: 'POST',
      headers: authHeaders(6001, 'mechanic_dev'),
      body: JSON.stringify({ id: 'is_mechanic_01' }),
    });

    const shareRes = await handleIdeaScoutRoute(shareReq, env, '/idea-scout/share');
    expect(shareRes.status).toBe(200);
    const shareBody = (await shareRes.json()) as { ok: boolean; card: CommunityIdeaCard; alreadyShared: boolean };
    expect(shareBody.ok).toBe(true);
    expect(shareBody.card.id).toBe('is_mechanic_01');
    expect(shareBody.card.ideaText).toContain('SMS appointment reminders');
    expect(shareBody.alreadyShared).toBe(false);

    // Verify it is now present in the community feed
    const feed = await loadCommunityFeed(env);
    const found = feed.find((item) => item.id === 'is_mechanic_01');
    expect(found).toBeDefined();
    expect(found?.upvotes).toBe(0);

    // Sharing again returns alreadyShared: true
    const reShareReq = new Request('https://luminarasuite.com/api/idea-scout/share', {
      method: 'POST',
      headers: authHeaders(6001, 'mechanic_dev'),
      body: JSON.stringify({ id: 'is_mechanic_01' }),
    });
    const reShareRes = await handleIdeaScoutRoute(reShareReq, env, '/idea-scout/share');
    const reShareBody = (await reShareRes.json()) as { alreadyShared: boolean };
    expect(reShareBody.alreadyShared).toBe(true);
  });

  it('upvotes a community idea card successfully', async () => {
    const env = envWithDb();

    // Fetch initial feed to get an existing card ID
    const feedRes = await handleIdeaScoutRoute(
      new Request('https://luminarasuite.com/api/idea-scout/feed', { method: 'GET' }),
      env,
      '/idea-scout/feed',
    );
    const feedBody = (await feedRes.json()) as { feed: CommunityIdeaCard[] };
    const targetCard = feedBody.feed[0]!;
    const initialUpvotes = targetCard.upvotes;

    // Upvote the card
    const voteReq = new Request('https://luminarasuite.com/api/idea-scout/vote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: targetCard.id }),
    });

    const voteRes = await handleIdeaScoutRoute(voteReq, env, '/idea-scout/vote');
    expect(voteRes.status).toBe(200);
    const voteBody = (await voteRes.json()) as { ok: boolean; id: string; upvotes: number };
    expect(voteBody.ok).toBe(true);
    expect(voteBody.id).toBe(targetCard.id);
    expect(voteBody.upvotes).toBe(initialUpvotes + 1);

    // Upvoting a non-existent card returns 404
    const badVoteRes = await handleIdeaScoutRoute(
      new Request('https://luminarasuite.com/api/idea-scout/vote', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'is_nonexistent_9999' }),
      }),
      env,
      '/idea-scout/vote',
    );
    expect(badVoteRes.status).toBe(404);
  });
});
