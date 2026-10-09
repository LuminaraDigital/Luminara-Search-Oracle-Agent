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
});
