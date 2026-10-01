import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validateInitData, createTelegramSessionToken, verifyTelegramSessionToken } from '../worker/telegramAuth';

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

  it('accepts auth_date within the default 1h TTL', async () => {
    // 30s inside the limit: one second inside raced the clock on slow CI runners.
    const authDate = String(Math.floor(Date.now() / 1000) - 3570);
    const r = await validateInitData(sign({ ...fresh(), auth_date: authDate }), token);
    expect(r.ok).toBe(true);
  });

  it('rejects auth_date older than the default 1h TTL', async () => {
    const authDate = String(Math.floor(Date.now() / 1000) - 3630);
    const r = await validateInitData(sign({ ...fresh(), auth_date: authDate }), token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/expired/);
  });

  it('honours an explicit longer ttlSeconds override', async () => {
    const authDate = String(Math.floor(Date.now() / 1000) - 5000);
    const r = await validateInitData(sign({ ...fresh(), auth_date: authDate }), token, 7200);
    expect(r.ok).toBe(true);
  });

  it('rejects missing hash and tampered user id after signing', async () => {
    expect((await validateInitData('auth_date=1&user=%7B%22id%22%3A1%7D', token)).ok).toBe(false);
    const signed = sign(fresh());
    const params = new URLSearchParams(signed);
    params.set('user', JSON.stringify({ id: 999, first_name: 'Eve' }));
    const r = await validateInitData(params.toString(), token);
    expect(r.ok).toBe(false);
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

  it('rejects duplicate parameters to prevent HTTP parameter pollution', async () => {
    const valid = sign(fresh());
    const withDuplicate = `${valid}&auth_date=9999999999`;
    const r = await validateInitData(withDuplicate, token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/duplicate parameter/i);
  });
});

describe('telegram session tokens', () => {
  const secret = 'test-signing-secret-at-least-32-chars-long';
  const user = {
    id: 12345,
    first_name: 'Alice',
    username: 'alice_tma',
  };

  it('creates and verifies a valid signed session token', async () => {
    const token = await createTelegramSessionToken(user, secret, 3600);
    expect(token).toMatch(/^tg_sess_/);
    const verified = await verifyTelegramSessionToken(token, secret);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.user.id).toBe(12345);
      expect(verified.user.username).toBe('alice_tma');
      expect(verified.user.first_name).toBe('Alice');
    }
  });

  it('rejects an expired session token', async () => {
    const token = await createTelegramSessionToken(user, secret, -10);
    const verified = await verifyTelegramSessionToken(token, secret);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toMatch(/expired/i);
  });

  it('rejects a session token with tampered payload or signature', async () => {
    const token = await createTelegramSessionToken(user, secret, 3600);
    const parts = token.slice('tg_sess_'.length).split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...user, id: 99999, exp: Math.floor(Date.now() / 1000) + 3600 })
    ).toString('base64url');
    const tamperedToken = `tg_sess_${tamperedPayload}.${parts[1]}`;
    const verified = await verifyTelegramSessionToken(tamperedToken, secret);
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toMatch(/signature/i);
  });

  it('rejects a session token verified with wrong secret', async () => {
    const token = await createTelegramSessionToken(user, secret, 3600);
    const verified = await verifyTelegramSessionToken(token, 'different-secret-for-verification');
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.reason).toMatch(/signature/i);
  });

  it('rejects malformed token formats', async () => {
    expect((await verifyTelegramSessionToken('not-a-token', secret)).ok).toBe(false);
    expect((await verifyTelegramSessionToken('tg_sess_invalid', secret)).ok).toBe(false);
    expect((await verifyTelegramSessionToken('tg_sess_.signature', secret)).ok).toBe(false);
  });
});
