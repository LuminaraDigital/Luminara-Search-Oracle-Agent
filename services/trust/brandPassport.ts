/**
 * Universal Brand Passport (ZetaChain Track ZP Pattern 5).
 *
 * Unifies Business DNA, domain ownership receipts, and trust attestations
 * into an authoritative, portable Brand Profile.
 * Provides canonical Schema.org Organization JSON-LD with verified sameAs links
 * and an embeddable trust badge snippet.
 */
import type { BusinessDNA } from '../../types';
import type { TrustReceiptView } from './receiptTypes';

export interface BrandPassport {
  domain: string;
  brandName: string;
  isVerified: boolean;
  receiptsCount: number;
  industry?: string;
  description?: string;
  sameAsUrls: string[];
  schemaJsonLd: string;
  embedBadgeSnippet: string;
  issuedAt: string;
}

/**
 * Generates canonical Schema.org Organization JSON-LD markup.
 */
export function generateOrganizationJsonLd(
  domain: string,
  brandName: string,
  sameAsUrls: string[] = [],
  description?: string,
): string {
  const payload: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: brandName,
    url: `https://${domain}`,
  };

  if (description && description.trim()) {
    payload.description = description.trim();
  }

  if (sameAsUrls.length > 0) {
    payload.sameAs = sameAsUrls;
  }

  return JSON.stringify(payload, null, 2);
}

/**
 * Generates an embeddable HTML badge snippet for the verified brand.
 */
export function generateEmbedBadgeHtml(domain: string, isVerified: boolean): string {
  const statusLabel = isVerified ? 'Verified by Luminara' : 'Luminara Profile';
  const color = isVerified ? '#d4af37' : '#94a3b8';
  return `<a href="https://luminarasuite.com/verify/${encodeURIComponent(domain)}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:9999px;background:#090d16;border:1px solid ${color};color:#f8fafc;font-family:system-ui,-apple-system,sans-serif;font-size:12px;text-decoration:none;"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:${color};"></span><span>${statusLabel}</span></a>`;
}

/**
 * Builds a unified Brand Passport entity.
 */
export function buildBrandPassport(
  domain: string,
  dna: BusinessDNA | null,
  receipts: TrustReceiptView[] = [],
): BrandPassport {
  const cleanDomain = domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
  const brandName = dna?.name?.trim() || cleanDomain;
  const isVerified = receipts.some(
    (r) =>
      r.payload.claim === 'domain_control' &&
      r.payload.level === 'worker_verified' &&
      !r.revokedAt,
  );

  const sameAsUrls: string[] = [];
  if (dna?.competitors) {
    // If socials or external links are recorded, capture them
  }

  const description = dna?.mission || dna?.usp || undefined;
  const schemaJsonLd = generateOrganizationJsonLd(cleanDomain, brandName, sameAsUrls, description);
  const embedBadgeSnippet = generateEmbedBadgeHtml(cleanDomain, isVerified);

  return {
    domain: cleanDomain,
    brandName,
    isVerified,
    receiptsCount: receipts.length,
    industry: dna?.industry || undefined,
    description,
    sameAsUrls,
    schemaJsonLd,
    embedBadgeSnippet,
    issuedAt: new Date().toISOString(),
  };
}
