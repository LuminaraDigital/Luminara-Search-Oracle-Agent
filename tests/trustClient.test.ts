import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { bytesToBase64Url, canonicalJson, receiptKeyId, type ReceiptPublicJwk } from '../services/trust/receiptCrypto';
import type { TrustReceiptPayload } from '../services/trust/receiptTypes';
import { receiptLevelSentence, verifyReceiptOffline } from '../services/trust/trustClient';

let publicJwk: ReceiptPublicJwk;
let otherJwk: ReceiptPublicJwk;
let payloadJson: string;
let signature: string;

const payload: TrustReceiptPayload = {
  v: 1,
  id: 'rcpt_0123456789abcdef01234567',
  iss: 'https://luminarasuite.com',
  kid: '',
  issuedAt: '2026-10-07T00:00:00.000Z',
  subject: { kind: 'domain', id: 'example.com' },
  claim: 'domain_control',
  level: 'worker_verified',
  method: 'dns_txt',
  evidence: [{ ref: 'dns', url: 'dns:_luminara.example.com', sha256: 'a'.repeat(64), fetchedAt: '2026-10-07T00:00:00.000Z' }],
  measurementStatus: 'measured',
};

async function makeJwk(pair: CryptoKeyPair): Promise<ReceiptPublicJwk> {
  const pub = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey;
  const x = String(pub.x);
  return { kty: 'OKP', crv: 'Ed25519', x, kid: await receiptKeyId(x) };
}

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const other = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  publicJwk = await makeJwk(pair);
  otherJwk = await makeJwk(other);
  payloadJson = canonicalJson({ ...payload, kid: publicJwk.kid });
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(payloadJson));
  signature = bytesToBase64Url(new Uint8Array(sig));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('verifyReceiptOffline', () => {
  it('accepts a receipt signed by a published key', async () => {
    const res = await verifyReceiptOffline({ kid: publicJwk.kid, payloadJson, signature }, [otherJwk, publicJwk]);
    expect(res).toEqual({ valid: true, kidFound: true });
  });

  it('rejects a tampered payload', async () => {
    const tampered = payloadJson.replace('example.com', 'evil.example');
    const res = await verifyReceiptOffline({ kid: publicJwk.kid, payloadJson: tampered, signature }, [publicJwk]);
    expect(res).toEqual({ valid: false, kidFound: true });
  });

  it('rejects a signature checked against the wrong key under the same kid', async () => {
    const res = await verifyReceiptOffline({ kid: publicJwk.kid, payloadJson, signature }, [{ ...otherJwk, kid: publicJwk.kid }]);
    expect(res).toEqual({ valid: false, kidFound: true });
  });

  it('reports a missing kid', async () => {
    const res = await verifyReceiptOffline({ kid: 'deadbeefdeadbeef', payloadJson, signature }, [publicJwk]);
    expect(res).toEqual({ valid: false, kidFound: false });
  });

  it('fetches /api/trust/keys when no key set is passed', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, issuer: 'x', keys: [publicJwk] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await verifyReceiptOffline({ kid: publicJwk.kid, payloadJson, signature });
    expect(res).toEqual({ valid: true, kidFound: true });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/\/api\/trust\/keys$/);
  });

  it('treats an unreachable key endpoint as key not found', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })));
    const res = await verifyReceiptOffline({ kid: publicJwk.kid, payloadJson, signature });
    expect(res).toEqual({ valid: false, kidFound: false });
  });
});

describe('receiptLevelSentence', () => {
  it('never renders self_reported as verified', () => {
    expect(receiptLevelSentence('self_reported')).toMatch(/did not verify/i);
    expect(receiptLevelSentence('worker_verified').endsWith('.')).toBe(true);
  });
});
