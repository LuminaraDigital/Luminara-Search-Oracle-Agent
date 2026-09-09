/**
 * Citation integrity layer for AEO empirical evidence.
 * Checks live URLs, brand/snippet overlap, spoof risk, and sameAs conflicts.
 * Deterministic heuristics only (reproducible reports).
 */

import type { EmpiricalCitationSummary, EmpiricalEvidence } from './empiricalCitationService';

export interface CitationIntegrityDetail {
  url: string;
  alive: boolean;
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

async function urlAlive(url: string): Promise<boolean> {
  try {
    const head = await fetch(url, { method: 'HEAD' }).catch(() => null);
    if (head) {
      if (head.ok) return true;
      // Some hosts reject HEAD; treat as inconclusive and fall through to GET
      if (head.status !== 405 && head.status !== 403 && head.status >= 400) return false;
    }
    const get = await fetch(url, { method: 'GET' }).catch(() => null);
    return Boolean(get && get.ok);
  } catch {
    return false;
  }
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
 *   0.40 * aliveRate
 * + 0.30 * avgBrandOverlap
 * + 0.20 * (100 if low spoof, 55 medium, 20 high)
 * + 0.10 * (0 if sameAsConflict else 100)
 * Missing cited URLs do not count as dead; they reduce measured sample.
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
    let deadCitationCount = 0;
    let overlapSum = 0;
    let measuredUrls = 0;

    for (const ev of summary.evidenceList) {
      if (!ev.citedUrl) continue;
      measuredUrls += 1;
      const alive = await urlAlive(ev.citedUrl);
      if (!alive) deadCitationCount += 1;
      const overlap = brandOverlapScore(brand, `${ev.snippet} ${ev.citedUrl}`);
      overlapSum += overlap;
      details.push({
        url: ev.citedUrl,
        alive,
        brandOverlap: overlap,
        notes: alive
          ? overlap >= 50
            ? 'Live citation with brand token overlap'
            : 'Live citation; weak brand token overlap'
          : 'Cited URL unreachable at audit time',
      });
    }

    const sameAsConflict = detectSameAsConflict(brand, domain, opts?.sameAsUrls || []);
    const spoofRisk = computeSpoofRisk(summary.evidenceList);

    const aliveRate =
      measuredUrls === 0 ? summary.citationRatePercent : Math.round(((measuredUrls - deadCitationCount) / measuredUrls) * 100);
    const avgOverlap = measuredUrls === 0 ? Math.max(20, summary.entityClarityScore) : Math.round(overlapSum / measuredUrls);
    const spoofScore = spoofRisk === 'low' ? 100 : spoofRisk === 'medium' ? 55 : 20;
    const sameAsScore = sameAsConflict ? 0 : 100;

    const integrityScore = Math.round(
      0.4 * aliveRate + 0.3 * avgOverlap + 0.2 * spoofScore + 0.1 * sameAsScore
    );

    return {
      integrityScore: Math.max(0, Math.min(100, integrityScore)),
      deadCitationCount,
      spoofRisk,
      sameAsConflict,
      details,
      measuredAt: Date.now(),
    };
  }
}

export const citationIntegrityService = CitationIntegrityService.getInstance();
