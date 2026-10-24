import { describe, expect, it } from 'vitest';
import worker from '../worker/index';
import type { Env } from '../worker/env';
import { signRequestMac, verifySignedRequest } from '../worker/requestSigning';
import { createSqliteD1 } from './helpers/sqliteD1';

const KEY_ID = 'k1';
const SECRET = 'test-request-signing-key-0123456789ab';
const KEYS = { [KEY_ID]: SECRET };
const PATH = '/webhooks/auth';
const BODY = '{"type":"ping"}';

function memoryNonces() {
  const seen = new Set<string>();
  return async (keyId: string, nonce: string) => {
    const id = `${keyId}:${nonce}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  };
}

async function signed(input: { body?: string; timestampSec: number; nonce: string; keyId?: string; secret?: string }) {
  const body = input.body ?? BODY;
  const keyId = input.keyId ?? KEY_ID;
  const signature = await signRequestMac({
    secret: input.secret ?? SECRET,
    keyId,
    timestampSec: input.timestampSec,
    nonce: input.nonce,
    method: 'POST',
    path: PATH,
    body,
  });
  return { body, signature, keyId };
}

describe('HMAC request signing', () => {
  const nowSec = 1_700_000_000;

  it('accepts a valid signature', async () => {
    const nonce = 'nonce-valid-0001';
    const { signature } = await signed({ timestampSec: nowSec, nonce });
    const result = await verifySignedRequest({
      keys: KEYS,
      keyId: KEY_ID,
      timestamp: String(nowSec),
      nonce,
      signature,
      method: 'POST',
      path: PATH,
      body: BODY,
      nowSec,
      consumeNonce: memoryNonces(),
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects a tampered body', async () => {
    const nonce = 'nonce-tamper-0001';
    const { signature } = await signed({ timestampSec: nowSec, nonce });
    const result = await verifySignedRequest({
      keys: KEYS,
      keyId: KEY_ID,
      timestamp: String(nowSec),
      nonce,
      signature,
      method: 'POST',
      path: PATH,
      body: '{"type":"pong"}',
      nowSec,
      consumeNonce: memoryNonces(),
    });
    expect(result).toEqual({ ok: false, code: 'tampered' });
  });

  it('rejects an expired timestamp', async () => {
    const nonce = 'nonce-expired-001';
    const timestampSec = nowSec - 301;
    const { signature } = await signed({ timestampSec, nonce });
    const result = await verifySignedRequest({
      keys: KEYS,
      keyId: KEY_ID,
      timestamp: String(timestampSec),
      nonce,
      signature,
      method: 'POST',
      path: PATH,
      body: BODY,
      nowSec,
      consumeNonce: memoryNonces(),
    });
    expect(result).toEqual({ ok: false, code: 'expired' });
  });

  it('rejects a replayed nonce', async () => {
    const nonce = 'nonce-replay-0001';
    const { signature } = await signed({ timestampSec: nowSec, nonce });
    const consumeNonce = memoryNonces();
    const first = await verifySignedRequest({
      keys: KEYS,
      keyId: KEY_ID,
      timestamp: String(nowSec),
      nonce,
      signature,
      method: 'POST',
      path: PATH,
      body: BODY,
      nowSec,
      consumeNonce,
    });
    const second = await verifySignedRequest({
      keys: KEYS,
      keyId: KEY_ID,
      timestamp: String(nowSec),
      nonce,
      signature,
      method: 'POST',
      path: PATH,
      body: BODY,
      nowSec,
      consumeNonce,
    });
    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, code: 'replayed' });
  });

  it('rejects an unknown key id', async () => {
    const nonce = 'nonce-unknown-001';
    const { signature } = await signed({ timestampSec: nowSec, nonce, keyId: 'retired', secret: SECRET });
    const result = await verifySignedRequest({
      keys: KEYS,
      keyId: 'retired',
      timestamp: String(nowSec),
      nonce,
      signature,
      method: 'POST',
      path: PATH,
      body: BODY,
      nowSec,
      consumeNonce: memoryNonces(),
    });
    expect(result).toEqual({ ok: false, code: 'unknown_key' });
  });

  it('POST /webhooks/auth uses the scheme when the flag is on, and keeps the old check when it is off', async () => {
    const env = {
      ASSETS: { fetch: async () => new Response('ok') },
      DB: createSqliteD1(),
      WEBAPP_URL: 'https://luminarasuite.com/',
      REQUEST_SIGNING_REQUIRED: 'true',
      REQUEST_SIGNING_KEYS: JSON.stringify(KEYS),
    } as Env;
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
    const now = Math.floor(Date.now() / 1000);
    const nonce = 'nonce-route-00001';
    const { signature } = await signed({ timestampSec: now, nonce });
    const headers = {
      'content-type': 'application/json',
      'cf-connecting-ip': '10.9.1.8',
      'x-luminara-key-id': KEY_ID,
      'x-luminara-timestamp': String(now),
      'x-luminara-nonce': nonce,
      'x-luminara-signature': signature,
    };
    const ok = await worker.fetch(new Request('https://luminarasuite.com/api/webhooks/auth', { method: 'POST', headers, body: BODY }), env, ctx);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, processed: 'ping' });

    const replay = await worker.fetch(
      new Request('https://luminarasuite.com/api/webhooks/auth', {
        method: 'POST',
        headers: { ...headers, 'cf-connecting-ip': '10.9.1.9' },
        body: BODY,
      }),
      env,
      ctx,
    );
    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({ code: 'replayed' });

    const off = { ...env, REQUEST_SIGNING_REQUIRED: 'false', AUTH_WEBHOOK_SECRET: 'webhook-secret-for-test-only' } as Env;
    const legacy = await worker.fetch(
      new Request('https://luminarasuite.com/api/webhooks/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.9.1.10' },
        body: BODY,
      }),
      off,
      ctx,
    );
    expect(legacy.status).toBe(401);
  });
});
