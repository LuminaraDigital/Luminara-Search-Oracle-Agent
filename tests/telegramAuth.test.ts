import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateInitData } from '../worker/telegramAuth';

const token = '123456:TEST_TOKEN';

function sign(fields: Record<string, string>, botToken = token): string {
  const dcs = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const hash = createHmac('sha256', secret).update(dcs).digest('hex');
  const p = new URLSearchParams(fields);
  p.set('hash', hash);
  return p.toString();
}

const fresh = () => ({
  auth_date: String(Math.floor(Date.now() / 1000)),
  query_id: 'AAE',
  user: JSON.stringify({ id: 42, first_name: 'Ada', username: 'ada' }),
  start_param: 'DASHBOARD',
});

describe('validateInitData', () => {
  it('accepts a correctly signed, fresh payload', async () => {
    const r = await validateInitData(sign(fresh()), token);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.user.id).toBe(42);
      expect(r.startParam).toBe('DASHBOARD');
    }
  });

  it('rejects a tampered hash', async () => {
    const data = sign(fresh()).replace(/hash=[a-f0-9]+/, `hash=${'f'.repeat(64)}`);
    const r = await validateInitData(data, token);
    expect(r.ok).toBe(false);
  });

  it('rejects a payload signed with another bot token', async () => {
    const r = await validateInitData(sign(fresh(), '999:OTHER'), token);
    expect(r.ok).toBe(false);
  });

  it('rejects stale auth_date', async () => {
    const r = await validateInitData(sign({ ...fresh(), auth_date: '1000' }), token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/expired/);
  });

  it('rejects garbage', async () => {
    expect((await validateInitData('', token)).ok).toBe(false);
    expect((await validateInitData('hash=abc', token)).ok).toBe(false);
  });
});
