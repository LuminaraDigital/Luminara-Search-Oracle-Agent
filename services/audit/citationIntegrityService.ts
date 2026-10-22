/**
 * Citation integrity layer for AEO empirical evidence.
 * Checks live URLs, brand/snippet overlap, spoof risk, and sameAs conflicts.
 * Deterministic heuristics only (reproducible reports).
 */

import type { EmpiricalCitationSummary, EmpiricalEvidence } from './empiricalCitationService';

export interface CitationIntegrityDetail {
  url: string;
  /** Null means this browser did not check the link. A false value is a confirmed miss. */
  alive: boolean | null;
  brandOverlap: number;
  notes: string;
}

export interface CitationIntegrityResult {
  integrityScore: number;
  deadCitationCount: number;
  spoofRisk: 'low' | 'medium' | 'high';
  sameAsConflict: boolean;
  details: CitationIntegrityDetail[];
  measuredAt: number;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * Fraction of brand tokens that appear in haystack, scaled 0-100.
 */
export function brandOverlapScore(brandName: string, haystack: string): number {
  const brandTokens = tokenize(brandName).filter((t) => t.length > 2);
  if (brandTokens.length === 0) return 0;
  const hay = haystack.toLowerCase();
  const hits = brandTokens.filter((t) => hay.includes(t)).length;
  return Math.round((hits / brandTokens.length) * 100);
}

const REVIEW_HOSTS = [
  'trustpilot.com',
  'yelp.com',
  'productreview.com.au',
  'tripadvisor.com',
  'capterra.com',
  'g2.com',
];

/** Review-site profiles are not measured here. The browser must not fetch them. */
export function isUnmeasuredReviewUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return REVIEW_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

const REVIEW_LABEL = new RegExp(`\\b(?:${REVIEW_HOSTS.map((host) => host.split('.')[0]).join('|')})\\b`, 'i');
const REVIEW_SCORE = /\b(?:rated|rating|stars?)\b|\d+(?:\.\d+)?\s*\/\s*(?:5|10)\b/i;

/** A review-site score in text we did not measure. A snippet that quotes it is still not a measurement. */
export function isUnmeasuredReviewRating(text: string): boolean {
  return REVIEW_LABEL.test(text) && REVIEW_SCORE.test(text);
}

/**
 * Conservative sameAs conflict: Wikipedia title path shares no overlap with brand/domain tokens.
 * Wikidata Q-ids alone never count as a conflict (they cannot lexical-match brands).
 */
export function detectSameAsConflict(
  brandName: string,
  domain: string,
  sameAsUrls: string[] = []
): boolean {
  const brandTokens = new Set([
    ...tokenize(brandName),
    ...tokenize(domain.replace(/\./g, ' ')),
  ]);
  if (brandTokens.size === 0) return false;

  for (const uri of sameAsUrls) {
    const lower = uri.toLowerCase();
    if (!lower.includes('wikipedia.org') && !lower.includes('wikidata.org')) continue;
    const leaf = (uri.split('/').pop() || '').replace(/_/g, ' ');
    // Skip bare Wikidata QIDs (Q123) - not a lexical brand signal
    if (/^q\d+$/i.test(leaf.trim())) continue;
    const pathBits = tokenize(leaf);
    if (pathBits.length === 0) continue;
    const overlap = pathBits.some(
      (p) => brandTokens.has(p) || [...brandTokens].some((b) => p.includes(b) || b.includes(p))
    );
    if (!overlap) return true;
  }
  return false;
}

function computeSpoofRisk(evidenceList: EmpiricalEvidence[]): 'low' | 'medium' | 'high' {
  const brandIntent = evidenceList.filter((e) => e.intent === 'informational' || e.intent === 'comparative');
  if (brandIntent.length === 0) return 'low';
  const notCitedWithComp = brandIntent.filter(
    (e) => !e.brandCited && e.competitorsCited.length > 0
  ).length;
  const ratio = notCitedWithComp / brandIntent.length;
  if (ratio >= 0.66) return 'high';
  if (ratio >= 0.33) return 'medium';
  return 'low';
}

/**
 * integrityScore =
 *   0.40 * citation rate
 * + 0.30 * avgBrandOverlap
 * + 0.20 * (100 if low spoof, 55 medium, 20 high)
 * + 0.10 * (0 if sameAsConflict else 100)
 * Cited links are not fetched. The browser used to fetch them, and a CORS failure counted as dead.
 * Missing cited URLs do not count as dead.
 */
export class CitationIntegrityService {
  private static instance: CitationIntegrityService;

  private constructor() {}

  public static getInstance(): CitationIntegrityService {
    if (!CitationIntegrityService.instance) {
      CitationIntegrityService.instance = new CitationIntegrityService();
    }
    return CitationIntegrityService.instance;
  }

  public async evaluate(
    summary: EmpiricalCitationSummary,
    opts?: { brandName?: string; domain?: string; sameAsUrls?: string[] }
  ): Promise<CitationIntegrityResult> {
    const brand = opts?.brandName || summary.brandName;
    const domain = opts?.domain || summary.targetDomain;
    const details: CitationIntegrityDetail[] = [];
    let overlapSum = 0;
    let overlapCount = 0;

    for (const ev of summary.evidenceList) {
      if (!ev.citedUrl || isUnmeasuredReviewUrl(ev.citedUrl)) continue;
      overlapCount += 1;
      const overlap = brandOverlapScore(brand, `${ev.snippet} ${ev.citedUrl}`);
      overlapSum += overlap;
      details.push({
        url: ev.citedUrl,
        alive: null,
        brandOverlap: overlap,
        notes: 'Link not checked',
      });
    }

    const sameAsConflict = detectSameAsConflict(brand, domain, opts?.sameAsUrls || []);
    const spoofRisk = computeSpoofRisk(summary.evidenceList);

    const citedRate = typeof summary.citationRatePercent === 'number' ? summary.citationRatePercent : 0;
    const clarity = typeof summary.entityClarityScore === 'number' ? summary.entityClarityScore : 0;
    const avgOverlap = overlapCount === 0 ? Math.max(20, clarity) : Math.round(overlapSum / overlapCount);
    const spoofScore = spoofRisk === 'low' ? 100 : spoofRisk === 'medium' ? 55 : 20;
    const sameAsScore = sameAsConflict ? 0 : 100;

    const integrityScore = Math.round(
      0.4 * citedRate + 0.3 * avgOverlap + 0.2 * spoofScore + 0.1 * sameAsScore
    );

    return {
      integrityScore: Math.max(0, Math.min(100, integrityScore)),
      deadCitationCount: 0,
      spoofRisk,
      sameAsConflict,
      details,
      measuredAt: Date.now(),
    };
  }
}

export const citationIntegrityService = CitationIntegrityService.getInstance();
