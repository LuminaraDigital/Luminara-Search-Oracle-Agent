import { describe, expect, it, vi } from 'vitest';
import { recordPaymentCompleted } from '../worker/paymentAnalytics';
import { writeSubscriptionRecord } from '../worker/userStore';
import { createSqliteD1 } from './helpers/sqliteD1';

function mockKv() {
  const store = new Map<string, string>();
  return {
    store,
    kv: {
      get: async (key: string, type?: string) => {
        const v = store.get(key);
        if (v === undefined) return null;
        return type === 'json' ? JSON.parse(v) : v;
      },
      put: async (key: string, value: string) => {
        store.set(key, value);
      },
    } as unknown as KVNamespace,
  };
}

async function paymentRows(DB: D1Database) {
  const res = await DB.prepare(
    "SELECT id, account_id, session_id, payload_json FROM product_analytics_events WHERE event_type = 'payment_completed'",
  ).all<{ id: string; account_id: string; session_id: string | null; payload_json: string }>();
  return res.results;
}

describe('recordPaymentCompleted', () => {
  it('writes one server-side row with the plan and rail only', async () => {
    const DB = createSqliteD1();
    await recordPaymentCompleted(
      { DB },
      'acct-1',
      { plan: 'growth', paymentMethod: 'stripe', sessionId: 'cs_test_1', customerId: 'cus_secret', currency: 'usd' },
    );
    const rows = await paymentRows(DB);
    expect(rows).toHaveLength(1);
    expect(rows[0].account_id).toBe('acct-1');
    expect(rows[0].session_id).toBeNull();
    expect(JSON.parse(rows[0].payload_json)).toEqual({ plan: 'growth', rail: 'stripe' });
    expect(rows[0].payload_json).not.toContain('cus_secret');
  });

  it('is idempotent per payment reference', async () => {
    const DB = createSqliteD1();
    const record = { plan: 'starter', paymentMethod: 'stars', chargeId: 'charge-1' };
    await recordPaymentCompleted({ DB }, 'acct-1', record);
    await recordPaymentCompleted({ DB }, 'acct-1', record);
    expect(await paymentRows(DB)).toHaveLength(1);
    await recordPaymentCompleted({ DB }, 'acct-1', { ...record, chargeId: 'charge-2' });
    expect(await paymentRows(DB)).toHaveLength(2);
  });

  it('never stores a license key in the event id', async () => {
    const DB = createSqliteD1();
    await recordPaymentCompleted({ DB }, 'acct-1', { plan: 'growth', paymentMethod: 'license_key', orderId: 'lic_LUM-SECRET-KEY' });
    const [row] = await paymentRows(DB);
    expect(row.id).toMatch(/^pay_[0-9a-f]{32}$/);
    expect(row.id).not.toContain('SECRET');
  });

  it('is a no-op without a database and swallows write errors', async () => {
    await expect(recordPaymentCompleted({}, 'acct-1', { plan: 'growth' })).resolves.toBeUndefined();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = { prepare: () => { throw new Error('d1 down'); } } as unknown as D1Database;
    await expect(recordPaymentCompleted({ DB: broken }, 'acct-1', { plan: 'growth' })).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('writeSubscriptionRecord emits payment_completed', () => {
  it('records the event after the grant lands, under the shared account id', async () => {
    const DB = createSqliteD1();
    const { kv, store } = mockKv();
    const { accountId } = await writeSubscriptionRecord(
      { DB, LUMINARA_KV: kv },
      'fb:abc',
      { plan: 'agency', paymentMethod: 'ton', orderId: 'order-9', startedAt: 1, expiresAt: 2 },
    );
    expect(store.has(`sub:${accountId}`)).toBe(true);
    const rows = await paymentRows(DB);
    expect(rows).toHaveLength(1);
    expect(rows[0].account_id).toBe(accountId);
    expect(JSON.parse(rows[0].payload_json)).toEqual({ plan: 'agency', rail: 'ton' });
  });

  it('does not fail the grant when analytics cannot be written', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { kv, store } = mockKv();
    const real = createSqliteD1();
    // Only the analytics insert fails; account resolution still reads the real tables.
    const broken = {
      prepare: (sql: string) => {
        if (sql.includes('product_analytics_events')) throw new Error('d1 down');
        return real.prepare(sql);
      },
    } as unknown as D1Database;
    const { accountId } = await writeSubscriptionRecord(
      { DB: broken, LUMINARA_KV: kv },
      'fb:abc',
      { plan: 'growth', paymentMethod: 'stripe', sessionId: 'cs_1' },
    );
    expect(store.has(`sub:${accountId}`)).toBe(true);
    spy.mockRestore();
  });
});
