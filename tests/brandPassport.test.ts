import { describe, expect, it } from 'vitest';
import {
  buildBrandPassport,
  generateEmbedBadgeHtml,
  generateOrganizationJsonLd,
} from '../services/trust/brandPassport';
import type { TrustReceiptView } from '../services/trust/receiptTypes';
import { normalizeVerifiableDomain } from '../worker/domainVerification';

describe('services/trust/brandPassport', () => {
  it('generates valid Schema.org Organization JSON-LD markup', () => {
    const jsonLd = generateOrganizationJsonLd(
      'example.com',
      'Acme Inc',
      ['https://twitter.com/acme', 'https://linkedin.com/company/acme'],
      'Pioneering smart tools',
    );

    const parsed = JSON.parse(jsonLd) as {
      '@context': string;
      '@type': string;
      name: string;
      url: string;
      description: string;
      sameAs: string[];
    };

    expect(parsed['@context']).toBe('https://schema.org');
    expect(parsed['@type']).toBe('Organization');
    expect(parsed.name).toBe('Acme Inc');
    expect(parsed.url).toBe('https://example.com');
    expect(parsed.description).toBe('Pioneering smart tools');
    expect(parsed.sameAs).toHaveLength(2);
  });

  it('generates an embeddable HTML badge snippet', () => {
    const verifiedBadge = generateEmbedBadgeHtml('luminarasuite.com', true);
    expect(verifiedBadge).toContain('Verified by Luminara');
    expect(verifiedBadge).toContain('luminarasuite.com');

    const unverifiedBadge = generateEmbedBadgeHtml('newdomain.com', false);
    expect(unverifiedBadge).toContain('Luminara Profile');
  });

  it('builds a verified brand passport when a worker_verified receipt exists', () => {
    const receipts: TrustReceiptView[] = [
      {
        id: 'rcpt_1',
        payload: {
          v: 1,
          id: 'rcpt_1',
          iss: 'luminarasuite.com',
          kid: 'kid_1',
          issuedAt: new Date().toISOString(),
          subject: { kind: 'domain', id: 'example.com' },
          claim: 'domain_control',
          level: 'worker_verified',
          method: 'dns_txt',
          evidence: [],
          measurementStatus: 'measured',
        },
        payloadJson: '{}',
        signature: 'sig',
        kid: 'kid_1',
        visibility: 'public',
        revokedAt: null,
        revokedReason: null,
      },
    ];

    const passport = buildBrandPassport('https://example.com', { name: 'Example Corp', industry: 'SaaS' } as any, receipts);

    expect(passport.domain).toBe('example.com');
    expect(passport.brandName).toBe('Example Corp');
    expect(passport.isVerified).toBe(true);
    expect(passport.receiptsCount).toBe(1);
    expect(passport.schemaJsonLd).toContain('Example Corp');
    expect(passport.embedBadgeSnippet).toContain('Verified by Luminara');
  });

  /** A live, verified domain control receipt for `subjectId`. */
  function domainReceipt(subjectId: string, overrides: Partial<TrustReceiptView> = {}): TrustReceiptView {
    const id = `rcpt_${subjectId}`;
    return {
      id,
      payload: {
        v: 1,
        id,
        iss: 'luminarasuite.com',
        kid: 'kid_1',
        issuedAt: '2026-10-10T00:00:00.000Z',
        subject: { kind: 'domain', id: subjectId },
        claim: 'domain_control',
        level: 'worker_verified',
        method: 'dns_txt',
        evidence: [],
        measurementStatus: 'measured',
      },
      payloadJson: '{}',
      signature: 'sig',
      kid: 'kid_1',
      visibility: 'public',
      revokedAt: null,
      revokedReason: null,
      ...overrides,
    };
  }

  it('refuses a receipt whose subject is a different domain', () => {
    const receipts = [domainReceipt('example.com')];

    for (const shown of ['victim.org', 'notexample.com', 'example.com.evil.net', 'sub.example.com', 'example.co']) {
      const passport = buildBrandPassport(shown, null, receipts);
      expect(passport.domain, shown).toBe(shown);
      expect(passport.isVerified, shown).toBe(false);
      expect(passport.receiptsCount, shown).toBe(0);
      expect(passport.embedBadgeSnippet, shown).not.toContain('Verified by Luminara');
      expect(passport.embedBadgeSnippet, shown).toContain('Luminara Profile');
    }
  });

  // The mirror of the test above: the shown domain stays fixed and the receipt's subject
  // varies. A match by suffix, prefix or substring passes the test above and fails here.
  it.each([
    ['a longer name that ends with it', 'notexample.com'],
    ['a sub-domain of it', 'sub.example.com'],
    ['its www host', 'www.example.com'],
    ['a name that starts with it', 'example.com.evil.net'],
    ['a name it starts with', 'example.co'],
    ['a name one letter short', 'xample.com'],
  ])('example.com is not verified by a receipt for %s (%s)', (_label, subject) => {
    const passport = buildBrandPassport('example.com', null, [domainReceipt(subject)]);
    expect(passport.domain).toBe('example.com');
    expect(passport.isVerified).toBe(false);
    expect(passport.receiptsCount).toBe(0);
    expect(passport.embedBadgeSnippet).not.toContain('Verified by Luminara');

    // The receipt itself is good: it verifies the passport of its own domain.
    expect(buildBrandPassport(subject, null, [domainReceipt(subject)]).isVerified).toBe(true);
  });

  it('counts and trusts only the live receipts for the domain it shows', () => {
    const receipts = [domainReceipt('example.com'), domainReceipt('other.org'), domainReceipt('third.net')];

    const passport = buildBrandPassport('other.org', null, receipts);
    expect(passport.isVerified).toBe(true);
    expect(passport.receiptsCount).toBe(1);

    // The receipt for the shown domain is revoked: the live ones for other domains do not
    // stand in, and the revoked one is not counted.
    const revoked = [
      domainReceipt('example.com'),
      domainReceipt('other.org', { revokedAt: '2026-10-10T01:00:00.000Z', revokedReason: 'test' }),
    ];
    const afterRevoke = buildBrandPassport('other.org', null, revoked);
    expect(afterRevoke.isVerified).toBe(false);
    expect(afterRevoke.receiptsCount).toBe(0);

    // One revoked and one live receipt for the same domain: one counts.
    const mixed = [
      domainReceipt('other.org', { id: 'rcpt_old', revokedAt: '2026-10-10T01:00:00.000Z', revokedReason: 'superseded' }),
      domainReceipt('other.org'),
    ];
    const reissued = buildBrandPassport('other.org', null, mixed);
    expect(reissued.isVerified).toBe(true);
    expect(reissued.receiptsCount).toBe(1);
  });

  it('does not treat a receipt about a non-domain subject with the same id as domain proof', () => {
    const receipt = domainReceipt('example.com');
    receipt.payload.subject = { kind: 'business', id: 'example.com' };
    const passport = buildBrandPassport('example.com', null, [receipt]);
    expect(passport.isVerified).toBe(false);
    expect(passport.receiptsCount).toBe(0);
  });

  it('calls two spellings the same domain exactly when domain verification does', () => {
    const receipts = [domainReceipt('example.com')];
    const spellings = [
      'example.com',
      'EXAMPLE.COM',
      'http://example.com',
      'https://Example.com/pricing?x=1',
      'example.com:8443',
      'example.com.',
      '  example.com  ',
      'www.example.com',
      'https://www.Example.com/pricing',
      'sub.example.com',
      'notexample.com',
      'example',
      'localhost',
      '',
    ];
    for (const shown of spellings) {
      // normalizeVerifiableDomain is the name a verification, and so a receipt, is stored under.
      const sameDomain = normalizeVerifiableDomain(shown) === 'example.com';
      expect(buildBrandPassport(shown, null, receipts).isVerified, JSON.stringify(shown)).toBe(sameDomain);
    }
    // Verification keeps `www.`, so the www host and the bare domain are two domains, both ways.
    expect(normalizeVerifiableDomain('www.example.com')).toBe('www.example.com');
    expect(buildBrandPassport('www.example.com', null, receipts).isVerified).toBe(false);
    expect(buildBrandPassport('www.example.com', null, [domainReceipt('www.example.com')])).toMatchObject({
      domain: 'www.example.com',
      isVerified: true,
      receiptsCount: 1,
    });
  });
});
