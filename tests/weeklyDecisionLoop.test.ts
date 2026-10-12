import { describe, expect, it, vi } from 'vitest';
import { sendWeeklyDecisionDigest } from '../worker/weeklyDecisionService';
import type { Env } from '../worker/env';
import { createSqliteD1 } from './helpers/sqliteD1';

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    ASSETS: { fetch: async () => new Response('ok') } as unknown as Fetcher,
    DB: createSqliteD1(),
    WEBAPP_URL: 'https://luminarasuite.com/',
    ALLOWED_ORIGINS: 'https://luminarasuite.com',
    BOT_TOKEN: '123456:WEEKLY_TEST',
    ...overrides,
  } as Env;
}

function isoWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

describe('sendWeeklyDecisionDigest', () => {
  it('returns 0 sent and 0 skipped when no decisions exist', async () => {
    const env = makeEnv();
    const result = await sendWeeklyDecisionDigest(env);
    expect(result).toEqual({ sent: 0, skipped: 0 });
  });

  it('delivers a plain-text decision digest to users with a connected Telegram account', async () => {
    const env = makeEnv();
    const week = isoWeekKey();
    const accountId = 'acct_tg_1';
    const now = Date.now();

    // Seed users with telegram_id
    await env.DB!.prepare(
      `INSERT INTO users (id, source, email, display_name, telegram_id, created_at, last_seen_at)
       VALUES (?, 'telegram', ?, ?, ?, ?, ?)`
    )
      .bind(accountId, 'founder@example.com', 'Founder', '99887766', now, now)
      .run();

    // Seed weekly decision for current week
    await env.DB!.prepare(
      `INSERT INTO weekly_decisions (
        id, account_id, domain, week_key, title, why_text,
        confidence, data_freshness, status, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        'dec_1',
        accountId,
        'example.com',
        week,
        'Deploy llms.txt context document',
        'Add public llms.txt with 40-60 word answer targets for AI search engines.',
        'high',
        'live',
        'open',
        1,
        now,
        now
      )
      .run();

    const fetchCalls: Array<{ url: string; body: any }> = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      fetchCalls.push({ url, body });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 101 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    try {
      const result = await sendWeeklyDecisionDigest(env);
      expect(result).toEqual({ sent: 1, skipped: 0 });
      expect(fetchCalls).toHaveLength(1);
      expect(fetchCalls[0].url).toContain('https://api.telegram.org/bot123456:WEEKLY_TEST/sendMessage');
      expect(fetchCalls[0].body.chat_id).toBe(99887766);
      expect(fetchCalls[0].body.text).toContain('Luminara Weekly Decision Digest');
      expect(fetchCalls[0].body.text).toContain('Domain: example.com');
      expect(fetchCalls[0].body.text).toContain('Verdict: Deploy llms.txt context document');
      expect(fetchCalls[0].body.text).toContain('Status: Measured live');
      expect(fetchCalls[0].body.text).not.toContain('\u2014');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it('skips delivery when user has no telegram_id linked', async () => {
    const env = makeEnv();
    const week = isoWeekKey();
    const accountId = 'acct_web_only';
    const now = Date.now();

    await env.DB!.prepare(
      `INSERT INTO users (id, source, email, display_name, telegram_id, created_at, last_seen_at)
       VALUES (?, 'firebase', ?, ?, NULL, ?, ?)`
    )
      .bind(accountId, 'web@example.com', 'Web Only', now, now)
      .run();

    await env.DB!.prepare(
      `INSERT INTO weekly_decisions (
        id, account_id, domain, week_key, title, why_text,
        confidence, data_freshness, status, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind('dec_2', accountId, 'webonly.com', week, 'Ship schema', 'Fix schema', 'high', 'sample', 'open', 1, now, now)
      .run();

    const result = await sendWeeklyDecisionDigest(env);
    expect(result).toEqual({ sent: 0, skipped: 0 });
  });
});
