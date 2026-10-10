import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReceiptCheckCard } from '../components/trust/VerifyReceiptView';
import { bytesToBase64Url, canonicalJson, receiptKeyId, type ReceiptPublicJwk } from '../services/trust/receiptCrypto';
import type { TrustReceiptPayload, TrustReceiptView } from '../services/trust/receiptTypes';
import {
  receiptLevelSentence,
  receiptSignatureNotice,
  revokedLine,
  revokedReasonSentence,
  verifyReceiptOffline,
} from '../services/trust/trustClient';
import { GATEWAY_RECEIPT_REVOKED_REASON } from '../worker/trustReceipts';

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

  it('does not say who withdrew it, because an owner can withdraw a receipt too', () => {
    const { detail } = receiptSignatureNotice('valid', true);
    expect(detail).toContain('It was later withdrawn.');
    expect(detail).not.toMatch(/withdrew|Luminara[^.]*withdr/);
  });

  it('keeps the warnings and the checking state for a withdrawn receipt', () => {
    for (const state of ['checking', 'invalid', 'key_not_found'] as const) {
      expect(receiptSignatureNotice(state, true), state).toEqual(receiptSignatureNotice(state, false));
      expect(receiptSignatureNotice(state, true).tone, state).not.toBe('valid');
    }
  });
});

describe('the receipt page (ReceiptCheckCard)', () => {
  /** A receipt as the gateway route stored it: evidence with a fetch time and HTTP 0, though nothing was fetched. */
  function receiptView(overrides: Partial<TrustReceiptView> = {}): TrustReceiptView {
    const shown: TrustReceiptPayload = {
      ...payload,
      kid: 'kid_page',
      evidence: [{ ref: 'target_homepage', url: 'https://example.com', sha256: 'a'.repeat(64), fetchedAt: '2026-10-07T00:00:00.000Z', httpStatus: 0 }],
    };
    return {
      id: shown.id,
      payload: shown,
      payloadJson: canonicalJson(shown),
      signature: 'sig',
      kid: 'kid_page',
      visibility: 'public',
      revokedAt: null,
      revokedReason: null,
      ...overrides,
    };
  }
  const render = (receipt: TrustReceiptView) => renderToStaticMarkup(createElement(ReceiptCheckCard, { receipt, sig: 'valid' }));
  /** The text of the warning banner at the top, or '' when there is none. */
  const banner = (html: string) => (html.match(/<div role="alert"[^>]*>([^<]*)<\/div>/) || ['', ''])[1];

  it('shows a receipt that stands with its level, its evidence lines and the gold valid notice', () => {
    const html = render(receiptView());
    expect(banner(html)).toBe('');
    expect(html).toContain('Valid signature');
    expect(html).toContain('border-gold/50');
    expect(html).toContain('Checked by Luminara.');
    expect(html).toContain('>fetched ');
    expect(html).toContain('>HTTP ');
  });

  it('shows a swept receipt as withdrawn first, with no claim that anything was checked or fetched', () => {
    const html = render(receiptView({ revokedAt: '2026-10-10T01:00:00.000Z', revokedReason: GATEWAY_RECEIPT_REVOKED_REASON }));

    // The banner comes before everything else, and each sentence ends with one full stop.
    expect(html.indexOf('role="alert"')).toBeGreaterThan(-1);
    expect(html.indexOf('role="alert"')).toBeLessThan(html.indexOf('role="status"'));
    expect(banner(html)).toMatch(/^Withdrawn .+\. This receipt was issued without a check and has been withdrawn\. This receipt no longer stands\.$/);
    expect(banner(html)).not.toContain('withdrawn..');

    expect(html).not.toContain('Valid signature');
    expect(html).not.toContain('border-gold/50');
    expect(html).toContain('It was later withdrawn.');
    expect(html).not.toContain('Checked by Luminara');
    expect(html).not.toContain('>fetched ');
    expect(html).not.toContain('>HTTP ');

    // The one date left besides the withdrawal is labelled as when the receipt was issued.
    expect(html).toMatch(/<dt[^>]*>Issued<\/dt>/);
    expect(html).toMatch(/<dt[^>]*>Level<\/dt><dd[^>]*><span[^>]*>Withdrawn\.<\/span>/);
  });

  it('reads right for a receipt its owner revoked', () => {
    const html = render(receiptView({ revokedAt: '2026-10-10T01:00:00.000Z', revokedReason: 'revoked by owner' }));
    expect(banner(html)).toMatch(/^Withdrawn .+\. Revoked by owner\. This receipt no longer stands\.$/);
    expect(html).not.toMatch(/Luminara signed this receipt and later withdrew it/);
    expect(html).not.toContain('Checked by Luminara');
  });
});

describe('revokedLine', () => {
  it('ends the date and the reason with one full stop each, whatever shape the stored reason has', () => {
    expect(revokedLine('10 Oct 2026', GATEWAY_RECEIPT_REVOKED_REASON)).toBe(
      'Revoked 10 Oct 2026. This receipt was issued without a check and has been withdrawn.',
    );
    expect(revokedLine('10 Oct 2026', 'domain removed by owner')).toBe('Revoked 10 Oct 2026. Domain removed by owner.');
    expect(revokedLine('10 Oct 2026', null)).toBe('Revoked 10 Oct 2026.');
    expect(revokedLine('10 Oct 2026', 'done.', 'Withdrawn')).toBe('Withdrawn 10 Oct 2026. Done.');
    for (const reason of [GATEWAY_RECEIPT_REVOKED_REASON, 'domain removed by owner', 'Why?', null, '']) {
      const line = revokedLine('10 Oct 2026', reason);
      expect(line, String(reason)).not.toMatch(/\.\.|\?\./);
      expect(line, String(reason)).toMatch(/[^.][.?]$/);
    }
  });

  it('is what the owner list of receipts prints, and only a receipt that stands gets its level sentence there', () => {
    const view = readFileSync(resolve(__dirname, '..', 'components', 'trust', 'TrustCenterView.tsx'), 'utf8');
    expect(view).toContain('revokedLine(formatDate(r.revokedAt), r.revokedReason)');
    expect(view).toContain('{!revoked && `${levelSentence(r.payload.level)} `}');
    // The old template put ": reason." after a reason that may already end with a full stop.
    expect(view).not.toContain(': ${r.revokedReason}');
  });
});

describe('receiptLevelSentence for a withdrawn receipt', () => {
  it('says withdrawn, not that anything was checked', () => {
    for (const level of ['worker_verified', 'registry_verified', 'self_reported'] as const) {
      expect(receiptLevelSentence(level, true), level).toBe('Withdrawn.');
    }
    expect(receiptLevelSentence('worker_verified')).toBe('Checked by Luminara.');
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
