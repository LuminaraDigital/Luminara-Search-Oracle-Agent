import { describe, expect, it } from 'vitest';
import {
  buildBrandPassport,
  generateEmbedBadgeHtml,
  generateOrganizationJsonLd,
} from '../services/trust/brandPassport';
import type { TrustReceiptView } from '../services/trust/receiptTypes';

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

  it('counts and trusts only the receipts for the domain it shows', () => {
    const receipts = [domainReceipt('example.com'), domainReceipt('other.org'), domainReceipt('third.net')];

    const passport = buildBrandPassport('other.org', null, receipts);
    expect(passport.isVerified).toBe(true);
    expect(passport.receiptsCount).toBe(1);

    // The receipt for the shown domain is revoked: the live ones for other domains do not stand in.
    const revoked = [
      domainReceipt('example.com'),
      domainReceipt('other.org', { revokedAt: '2026-10-10T01:00:00.000Z', revokedReason: 'test' }),
    ];
    expect(buildBrandPassport('other.org', null, revoked).isVerified).toBe(false);
  });

  it('does not treat a receipt about a non-domain subject with the same id as domain proof', () => {
    const receipt = domainReceipt('example.com');
    receipt.payload.subject = { kind: 'business', id: 'example.com' };
    const passport = buildBrandPassport('example.com', null, [receipt]);
    expect(passport.isVerified).toBe(false);
    expect(passport.receiptsCount).toBe(0);
  });

  it('still matches the same domain written with a scheme, www, a path or capitals', () => {
    const receipts = [domainReceipt('example.com')];
    for (const shown of ['https://www.Example.com/pricing', 'EXAMPLE.COM', 'http://example.com']) {
      expect(buildBrandPassport(shown, null, receipts).isVerified, shown).toBe(true);
    }
    expect(buildBrandPassport('example.com', null, [domainReceipt('www.example.com')]).isVerified).toBe(true);
  });
});
