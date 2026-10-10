/**
 * Universal Brand Passport (ZetaChain Track ZP Pattern 5).
 *
 * Unifies Business DNA, domain ownership receipts, and trust attestations
 * into an authoritative, portable Brand Profile.
 * Provides canonical Schema.org Organization JSON-LD with verified sameAs links
 * and an embeddable trust badge snippet.
 */
import type { BusinessDNA } from '../../types';
import { safePublicHostname } from '../security/publicHostname';
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
 *
 * `receipts` may be every receipt the account holds, for several domains. Only a
 * live receipt whose subject is this passport's domain counts, so a receipt for
 * another domain, or a revoked one, never marks it verified or adds to its count.
 *
 * Two spellings are the same domain by the rule domain verification names a domain
 * with (normalizeVerifiableDomain in worker/domainVerification.ts, which is
 * safePublicHostname): lower case, no scheme, port or path. `www.` is kept, so
 * www.example.com and example.com are two domains here, as they are two separate
 * verifications there. Text that is not a public hostname matches no receipt.
 */
export function buildBrandPassport(
  domain: string,
  dna: BusinessDNA | null,
  receipts: TrustReceiptView[] = [],
): BrandPassport {
  const shownHost = safePublicHostname(domain);
  const cleanDomain = shownHost ?? domain.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  const brandName = dna?.name?.trim() || cleanDomain;
  const liveReceipts =
    shownHost === null
      ? []
      : receipts.filter(
          (r) =>
            !r.revokedAt &&
            r.payload.subject?.kind === 'domain' &&
            safePublicHostname(String(r.payload.subject.id || '')) === shownHost,
        );
  const isVerified = liveReceipts.some(
    (r) => r.payload.claim === 'domain_control' && r.payload.level === 'worker_verified',
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
    receiptsCount: liveReceipts.length,
    industry: dna?.industry || undefined,
    description,
    sameAsUrls,
    schemaJsonLd,
    embedBadgeSnippet,
    issuedAt: new Date().toISOString(),
  };
}
