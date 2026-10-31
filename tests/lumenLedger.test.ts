import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { PLANS } from '../worker/telegramBot';
import {
  LUMEN_ROUTES_ENABLED,
  clawbackLumen,
  lumenEntryLabel,
  lumenGrantFor,
  mintLumen,
  readLumenAccount,
  spendLumen,
} from '../worker/lumenLedger';
import { LUMEN_PUBLIC_NOTE } from '../services/lumen/lumenCopy';
import { parseLumenView } from '../components/settings/LumenBalance';
import { createSqliteD1 } from './helpers/sqliteD1';

function env(): Env {
  return { DB: createSqliteD1() } as Env;
}

describe('lumen ledger', () => {
  it('grants the Stars price of each plan and nothing else', () => {
    for (const [id, plan] of Object.entries(PLANS)) {
      expect(lumenGrantFor(id)).toBe(plan.stars);
    }
    expect(lumenGrantFor('nope')).toBe(0);
    expect(LUMEN_ROUTES_ENABLED).toBe(false);
  });

  it('mints a purchase once and spends one job without going negative', async () => {
    const db = env();
    const first = await mintLumen(db, {
      accountId: 'acct',
      source: 'stripe',
      amount: lumenGrantFor('starter'),
      idempotencyKey: 'stripe:cs_1',
      refId: 'cs_1',
      now: 10,
    });
    const again = await mintLumen(db, {
      accountId: 'acct',
      source: 'stripe',
      amount: lumenGrantFor('starter'),
      idempotencyKey: 'stripe:cs_1',
      now: 11,
    });
    expect(first).toEqual({ applied: true, balance: 2500 });
    expect(again).toEqual({ applied: false, reason: 'duplicate', balance: 2500 });

    const spent = await spendLumen(db, {
      accountId: 'acct',
      source: 'audit',
      idempotencyKey: 'audit:run-1',
      now: 12,
    });
    const spentAgain = await spendLumen(db, {
      accountId: 'acct',
      source: 'audit',
      idempotencyKey: 'audit:run-1',
      now: 13,
    });
    expect(spent).toEqual({ applied: true, balance: 2499 });
    expect(spentAgain).toEqual({ applied: false, reason: 'duplicate', balance: 2499 });

    const empty = env();
    const missed = await spendLumen(empty, {
      accountId: 'acct',
      source: 'mcp',
      idempotencyKey: 'mcp:run-1',
      now: 14,
    });
    expect(missed).toEqual({ applied: false, reason: 'short', balance: 0 });
    const view = await readLumenAccount(empty, 'acct');
    expect(view.balance).toBe(0);
    expect(view.routesEnabled).toBe(false);
    expect(view.tonMirror).toBe(false);
  });

  it('claws back only the unspent remainder, once', async () => {
    const db = env();
    await mintLumen(db, {
      accountId: 'acct',
      source: 'stars',
      amount: 25,
      idempotencyKey: 'stars:ch_1',
      now: 1,
    });
    await spendLumen(db, { accountId: 'acct', source: 'agent', idempotencyKey: 'agent:run-1', now: 2 });
    const clawed = await clawbackLumen(db, {
      accountId: 'acct',
      mintKey: 'stars:ch_1',
      voidKey: 'void:stars:ch_1',
      now: 3,
    });
    expect(clawed).toEqual({ applied: true, balance: 0 });
    const again = await clawbackLumen(db, {
      accountId: 'acct',
      mintKey: 'stars:ch_1',
      voidKey: 'void:stars:ch_1',
      now: 4,
    });
    expect(again.applied).toBe(false);
    if (!again.applied) expect(again.reason).toBe('duplicate');
    await mintLumen(db, {
      accountId: 'acct',
      source: 'ton',
      amount: 25,
      idempotencyKey: 'ton:tx_2',
      now: 5,
    });
    const view = await readLumenAccount(db, 'acct');
    expect(view.balance).toBe(25);
    expect(view.entries[0]?.label).toBe('Added 25 from a purchase');
    expect(view.note).toBe(LUMEN_PUBLIC_NOTE);
    expect(view.note).not.toMatch(/\bburn\b|wallet|stake|yield/i);
  });

  it('marks a refund that finds an empty balance so a later purchase stays', async () => {
    const db = env();
    await mintLumen(db, {
      accountId: 'acct',
      source: 'stripe',
      amount: 2,
      idempotencyKey: 'stripe:cs_2',
      now: 1,
    });
    await spendLumen(db, { accountId: 'acct', source: 'mcp', idempotencyKey: 'mcp:a', now: 2 });
    await spendLumen(db, { accountId: 'acct', source: 'mcp', idempotencyKey: 'mcp:b', now: 3 });
    const clawed = await clawbackLumen(db, {
      accountId: 'acct',
      mintKey: 'stripe:cs_2',
      voidKey: 'void:stripe:cs_2',
      now: 4,
    });
    expect(clawed).toMatchObject({ applied: false, reason: 'short', balance: 0 });
    await mintLumen(db, {
      accountId: 'acct',
      source: 'stripe',
      amount: 10,
      idempotencyKey: 'stripe:cs_3',
      now: 5,
    });
    const replay = await clawbackLumen(db, {
      accountId: 'acct',
      mintKey: 'stripe:cs_2',
      voidKey: 'void:stripe:cs_2',
      now: 6,
    });
    expect(replay).toMatchObject({ applied: false, reason: 'duplicate', balance: 10 });
    expect(lumenEntryLabel({ direction: 'void', amount: 0, source: 'stripe', idempotencyKey: 'void:stripe:cs_2' })).toBe(
      'Refund recorded. Nothing left to reverse.',
    );
  });

  it('GET /api/lumen is 401 signed out and a zero balance when signed in', async () => {
    const botToken = '123456:LUMEN_TEST';
    const fields: Record<string, string> = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      user: JSON.stringify({ id: 88001, first_name: 'Ada' }),
    };
    const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
    const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
    const params = new URLSearchParams(fields);
    params.set('hash', createHmac('sha256', secret).update(dcs).digest('hex'));
    const routeEnv = {
      ASSETS: { fetch: async () => new Response('ok') },
      LUMINARA_KV: {
        get: async () => null,
        put: async () => undefined,
        delete: async () => undefined,
      },
      DB: createSqliteD1(),
      BOT_TOKEN: botToken,
      WEBAPP_URL: 'https://luminarasuite.com/',
      ALLOWED_ORIGINS: 'https://luminarasuite.com',
    } as unknown as Env;
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
    const unsigned = await worker.fetch(new Request('https://luminarasuite.com/api/lumen'), routeEnv, ctx);
    expect(unsigned.status).toBe(401);
    const signed = await worker.fetch(
      new Request('https://luminarasuite.com/api/lumen', {
        headers: { 'x-telegram-init-data': params.toString(), 'cf-connecting-ip': '10.8.0.9' },
      }),
      routeEnv,
      ctx,
    );
    expect(signed.status).toBe(200);
    const body = parseLumenView(await signed.json());
    expect(body).toEqual({ balance: 0, entries: [] });
  });
});
