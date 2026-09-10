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

  it('accepts Bot API 7.2+ payloads that include signature in the HMAC data-check-string', async () => {
    // Real Telegram Desktop/clients attach `signature` (Ed25519). First-party HMAC `hash`
    // is computed OVER that field. Excluding it breaks every live Mini App session.
    const fields = {
      ...fresh(),
      signature: 'FakeEd25519SignatureForHmacCoverageOnly_',
    };
    const r = await validateInitData(sign(fields), token);
    expect(r.ok).toBe(true);
  });

  it('rejects when signature was stripped after Telegram signed the full payload', async () => {
    const fields = {
      ...fresh(),
      signature: 'FakeEd25519SignatureForHmacCoverageOnly_',
    };
    const full = sign(fields);
    // Simulate the old buggy validator path: recompute would fail if signature removed pre-hash.
    const withoutSig = full
      .split('&')
      .filter((p) => !p.startsWith('signature='))
      .join('&');
    // Hash still claims to cover signature, so validation must fail.
    const r = await validateInitData(withoutSig, token);
    expect(r.ok).toBe(false);
  });
});
