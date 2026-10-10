import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALLOWED_TYPES, ingestProductAnalytics } from '../worker/productAnalytics';
import { createSqliteD1 } from './helpers/sqliteD1';
import type { Env } from '../worker/env';

/** Event names the browser client may emit, read from the TelemetryEventType union source. */
function clientEventTypes(): string[] {
  const source = readFileSync(resolve(__dirname, '..', 'services', 'analytics', 'productTelemetry.ts'), 'utf8');
  const block = source.match(/export type TelemetryEventType =([\s\S]*?);/);
  if (!block) throw new Error('TelemetryEventType union not found');
  return [...block[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

function post(events: Array<{ type: string; data?: unknown }>): Request {
  return new Request('https://worker.test/api/analytics/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 's1', events }),
  });
}

describe('product analytics allow-list parity', () => {
  it('accepts every event type the client can emit (no silent drops)', () => {
    const missing = clientEventTypes().filter((type) => !ALLOWED_TYPES.has(type));
    expect(missing).toEqual([]);
  });

  it('keeps payment_completed server-only: not emittable by the client, not accepted from it', async () => {
    expect(clientEventTypes()).not.toContain('payment_completed');
    expect(ALLOWED_TYPES.has('payment_completed')).toBe(false);

    const DB = createSqliteD1();
    const res = await ingestProductAnalytics(
      post([{ type: 'payment_completed', data: { planId: 'agency' } }, { type: 'checkout_started', data: { planId: 'agency' } }]),
      { DB } as unknown as Env,
      null,
    );
    expect(await res.json()).toMatchObject({ ok: true, inserted: 1 });
    const rows = await DB.prepare('SELECT event_type FROM product_analytics_events').all<{ event_type: string }>();
    expect(rows.results.map((r) => r.event_type)).toEqual(['checkout_started']);
  });
});
