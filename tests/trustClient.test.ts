import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bytesToBase64Url, canonicalJson, receiptKeyId, type ReceiptPublicJwk } from '../services/trust/receiptCrypto';
import type { TrustReceiptPayload } from '../services/trust/receiptTypes';
import {
  receiptLevelSentence,
  receiptSignatureNotice,
  revokedReasonSentence,
  verifyReceiptOffline,
} from '../services/trust/trustClient';

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

describe('receiptSignatureNotice', () => {
  it('shows a genuine signature in the success style only while the receipt stands', () => {
    expect(receiptSignatureNotice('valid', false)).toMatchObject({ label: 'Valid signature', tone: 'valid' });
  });

  it('shows a withdrawn receipt as withdrawn, never as a valid signature in the success style', () => {
    const notice = receiptSignatureNotice('valid', true);
    expect(notice.label).toBe('Withdrawn');
    expect(notice.tone).toBe('withdrawn');
    expect(notice.tone).not.toBe('valid');
    expect(`${notice.label} ${notice.detail}`).not.toContain('Valid signature');
    expect(notice.detail).toContain('no longer stands');
  });

  it('is where the receipt page gets its notice, with the withdrawn state passed in', () => {
    const view = readFileSync(resolve(__dirname, '..', 'components', 'trust', 'VerifyReceiptView.tsx'), 'utf8');
    expect(view).toContain('receiptSignatureNotice(');
    expect(view).toContain('Boolean(receipt?.revokedAt)');
    expect(view).toContain('revokedReasonSentence(receipt.revokedReason)');
    // The page keeps no copy of its own that could show the success notice for a withdrawn receipt.
    expect(view).not.toContain('Valid signature');
  });

  it('keeps the warnings and the checking state for a withdrawn receipt', () => {
    for (const state of ['checking', 'invalid', 'key_not_found'] as const) {
      expect(receiptSignatureNotice(state, true), state).toEqual(receiptSignatureNotice(state, false));
      expect(receiptSignatureNotice(state, true).tone, state).not.toBe('valid');
    }
  });
});

describe('revokedReasonSentence', () => {
  it('ends every stored reason with a full stop and starts it with a capital', () => {
    expect(revokedReasonSentence('domain removed by owner')).toBe('Domain removed by owner.');
    expect(revokedReasonSentence('superseded by a newer domain check')).toBe('Superseded by a newer domain check.');
    expect(revokedReasonSentence('  no longer ours  ')).toBe('No longer ours.');
  });

  it('leaves a reason that is already a sentence alone, and says nothing when there is none', () => {
    expect(revokedReasonSentence('This receipt was issued without a check and has been withdrawn.')).toBe(
      'This receipt was issued without a check and has been withdrawn.',
    );
    expect(revokedReasonSentence('Why?')).toBe('Why?');
    expect(revokedReasonSentence(null)).toBe('');
    expect(revokedReasonSentence('   ')).toBe('');
  });
});
