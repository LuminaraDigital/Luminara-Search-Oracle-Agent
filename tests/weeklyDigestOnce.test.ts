import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendWeeklyDecisionDigest } from '../worker/weeklyDecisionService';
import type { Env } from '../worker/env';
import { createSqliteD1 } from './helpers/sqliteD1';

function isoWeekKey(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

const db = () => createSqliteD1();

function makeEnv(DB: Env['DB']): Env {
  return { DB, BOT_TOKEN: '123456:DIGEST_ONCE', WEBAPP_URL: 'https://luminarasuite.com' } as Env;
}

/** Telegram stub: records each message and answers ok unless the next reply is queued as failed. */
function stubTelegram(failures: boolean[] = []) {
  const chatIds: number[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      chatIds.push(JSON.parse(String(init?.body)).chat_id);
      const ok = !failures.shift();
      return new Response(JSON.stringify(ok ? { ok: true } : { ok: false, description: 'down' }));
    }),
  );
  return chatIds;
}

async function seedUser(DB: Env['DB'], id: string, accountId: string | null, telegramId: string | null) {
  const now = Date.now();
  await DB!
    .prepare(
      `INSERT INTO users (id, source, email, display_name, telegram_id, account_id, created_at, last_seen_at)
       VALUES (?, 'telegram', ?, 'Test', ?, ?, ?, ?)`,
    )
    .bind(id, `${id}@example.com`, telegramId, accountId, now, now)
    .run();
}

async function seedDecision(DB: Env['DB'], id: string, accountId: string, domain: string) {
  const now = Date.now();
  await DB!
    .prepare(
      `INSERT INTO weekly_decisions (id, account_id, domain, week_key, title, why_text,
         confidence, data_freshness, status, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'Ship it', 'Do it', 'high', 'live', 'open', 1, ?, ?)`,
    )
    .bind(id, accountId, domain, isoWeekKey(), now, now)
    .run();
}

afterEach(() => vi.unstubAllGlobals());

// Drives sendWeeklyDecisionDigest twice, the function the daily scheduled() fire calls.
describe('weekly digest sends once', () => {
  it('sends one decision once across two runs in the same week', async () => {
    const DB = db();
    await seedUser(DB, 'u1', 'u1', '111');
    await seedDecision(DB, 'd1', 'u1', 'a.com');
    const chatIds = stubTelegram();

    expect(await sendWeeklyDecisionDigest(makeEnv(DB))).toEqual({ sent: 1, skipped: 0 });
    expect(await sendWeeklyDecisionDigest(makeEnv(DB))).toEqual({ sent: 0, skipped: 0 });
    expect(chatIds).toEqual([111]);
  });

  it('sends two domains for one account as two messages, then none', async () => {
    const DB = db();
    await seedUser(DB, 'u1', 'u1', '111');
    await seedDecision(DB, 'd1', 'u1', 'a.com');
    await seedDecision(DB, 'd2', 'u1', 'b.com');
    const chatIds = stubTelegram();

    expect(await sendWeeklyDecisionDigest(makeEnv(DB))).toEqual({ sent: 2, skipped: 0 });
    expect(await sendWeeklyDecisionDigest(makeEnv(DB))).toEqual({ sent: 0, skipped: 0 });
    expect(chatIds).toEqual([111, 111]);
  });

  it('leaves no sent mark when the sender fails and sends on the next run', async () => {
    const DB = db();
    await seedUser(DB, 'u1', 'u1', '111');
    await seedDecision(DB, 'd1', 'u1', 'a.com');
    const chatIds = stubTelegram([true]);

    expect(await sendWeeklyDecisionDigest(makeEnv(DB))).toEqual({ sent: 0, skipped: 1 });
    const row = await DB.prepare('SELECT telegram_sent_at FROM weekly_decisions WHERE id = ?').bind('d1').first();
    expect(row).toEqual({ telegram_sent_at: null });

    expect(await sendWeeklyDecisionDigest(makeEnv(DB))).toEqual({ sent: 1, skipped: 0 });
    expect(chatIds).toEqual([111, 111]);
  });

  it('reaches the Telegram row of a linked account whose billing id is not that row id', async () => {
    const DB = db();
    await seedUser(DB, 'firebase_1', 'acct_canon', null);
    await seedUser(DB, 'tg_1', 'acct_canon', '222');
    await seedDecision(DB, 'd1', 'acct_canon', 'a.com');
    const chatIds = stubTelegram();

    expect(await sendWeeklyDecisionDigest(makeEnv(DB))).toEqual({ sent: 1, skipped: 0 });
    expect(chatIds).toEqual([222]);
  });
});
