/**
 * AEO Cite-Worthiness Trust Pack composer.
 * Weighted deterministic score from security, citation integrity, entity clarity, schema safety.
 */

import type { SecurityPosture } from '../enrichment/publicApisEnrichmentService';
import type { EmpiricalCitationSummary } from './empiricalCitationService';
import type { CitationIntegrityResult } from './citationIntegrityService';
import type { SchemaSafetyResult } from '../deployment/schemaSafetyGate';
import { schemaSafetyScore } from '../deployment/schemaSafetyGate';

export type YmylTier = 'none' | 'elevated' | 'high';
export type SignalStatus = 'measured' | 'inferred' | 'not_measured';

export interface TrustPackFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  detail: string;
}

export interface TrustPackSummary {
  citeWorthiness: number;
  securityTrust: number;
  citationIntegrity: number;
  entityClarity: number;
  schemaSafety: number;
  ymylTier: YmylTier;
  findings: TrustPackFinding[];
  formula: string;
  measuredAt: number;
  /** Cap applied from weakest measurement confidence (CEO acceptance: score never outruns honesty). */
  confidenceCap: number;
  signalStatus: {
    security: SignalStatus;
    integrity: SignalStatus;
    entityClarity: SignalStatus;
    schema: SignalStatus;
  };
}

const FORMULA =
  'citeWorthiness = min(0.30*securityTrust + 0.30*citationIntegrity + 0.20*entityClarity + 0.20*schemaSafety, confidenceCap)';

/** Caps composite score so CORS-limited / failed measurements cannot overclaim cite-worthiness. */
export function confidenceCapFor(input: TrustPackInput): number {
  const caps: number[] = [100];
  if (input.security) {
    if (input.security.measurementConfidence === 'failed') caps.push(50);
    else if (input.security.measurementConfidence === 'cors_limited') caps.push(70);
    else caps.push(100);
  } else {
    caps.push(80); // security not measured
  }
  if (!input.integrity) caps.push(85);
  if (!input.empirical) caps.push(85);
  if (!input.schemaSafety) caps.push(85);
  return Math.min(...caps);
}

// high: health, medical, finance, bank, legal, attorney
// elevated: insurance, mortgage
const HIGH_YMYL = /\b(health|medical|clinic|dental|pharma|financ|bank|attorney|lawyer|legal)\b/i;
const ELEVATED_YMYL = /\b(insurance|mortgage|credit|loan|tax|therapy|nutrition|wellness)\b/i;

export function detectYmylTier(text: string, domain?: string): YmylTier {
  const hay = `${text || ''} ${domain || ''}`;
  if (HIGH_YMYL.test(hay)) return 'high';
  if (ELEVATED_YMYL.test(hay)) return 'elevated';
  return 'none';
}

export interface TrustPackInput {
  security?: SecurityPosture | null;
  empirical?: EmpiricalCitationSummary | null;
  integrity?: CitationIntegrityResult | null;
  schemaSafety?: SchemaSafetyResult | null;
  reportText?: string;
  brandName?: string;
  domain?: string;
}

export class AeoTrustPackService {
  private static instance: AeoTrustPackService;

  private constructor() {}

  public static getInstance(): AeoTrustPackService {
    if (!AeoTrustPackService.instance) {
      AeoTrustPackService.instance = new AeoTrustPackService();
    }
    return AeoTrustPackService.instance;
  }

  public build(input: TrustPackInput): TrustPackSummary {
    const findings: TrustPackFinding[] = [];

    const securityTrust = input.security?.trustScore ?? 0;
    const citationIntegrity = input.integrity?.integrityScore ?? 0;
    const entityClarity = input.empirical?.entityClarityScore ?? 0;
    const schemaSafety = input.schemaSafety
      ? schemaSafetyScore(input.schemaSafety)
      : 0;

    const rawWorthiness = Math.round(
      0.3 * securityTrust + 0.3 * citationIntegrity + 0.2 * entityClarity + 0.2 * schemaSafety
    );

    const ymylTier = detectYmylTier(
      `${input.reportText || ''} ${input.brandName || ''}`,
      input.domain
    );

    let confidenceCap = confidenceCapFor(input);
    // YMYL high without verified HTTPS+HSTS cannot claim cite-worthy territory
    if (
      ymylTier === 'high' &&
      input.security &&
      (!input.security.httpsEnforced || !input.security.hstsEnabled || input.security.measurementConfidence !== 'full')
    ) {
      confidenceCap = Math.min(confidenceCap, 59);
    }

    const citeWorthiness = Math.max(0, Math.min(100, Math.min(rawWorthiness, confidenceCap)));

    if (rawWorthiness > confidenceCap) {
      findings.push({
        severity: 'medium',
        title: 'Cite-worthiness capped by measurement confidence',
        detail: `Raw weighted score ${rawWorthiness} capped at ${confidenceCap} so the composite cannot outrun the weakest measurement confidence.`,
      });
    }

    if (input.security?.measurementConfidence === 'cors_limited') {
      findings.push({
        severity: 'medium',
        title: 'Security headers CORS-limited',
        detail: 'Browser could not read response headers. Prefer Worker enrichment for full measurement.',
      });
    }

    if (input.security && !input.security.httpsEnforced) {
      findings.push({
        severity: 'critical',
        title: 'HTTPS not enforced',
        detail: 'Answer engines and browsers treat non-HTTPS origins as low trust.',
      });
    } else if (input.security && !input.security.hstsEnabled) {
      findings.push({
        severity: ymylTier === 'high' ? 'critical' : 'high',
        title: 'HSTS missing',
        detail: 'Strict-Transport-Security was not observed. Add HSTS for durable transport trust.',
      });
    }

    if (input.integrity?.spoofRisk === 'high') {
      findings.push({
        severity: 'high',
        title: 'Citation spoof risk high',
        detail: 'Competitors appear for brand-intent queries while the brand is not cited.',
      });
    }

    if (input.integrity && input.integrity.deadCitationCount > 0) {
      findings.push({
        severity: 'high',
        title: 'Dead citation URLs',
        detail: `${input.integrity.deadCitationCount} cited URL(s) were unreachable at audit time.`,
      });
    }

    if (input.integrity?.sameAsConflict) {
      findings.push({
        severity: 'medium',
        title: 'sameAs entity conflict',
        detail: 'Wikidata/Wikipedia sameAs URIs do not clearly match the brand tokens.',
      });
    }

    if (input.schemaSafety && !input.schemaSafety.okToDeploy) {
      findings.push({
        severity: 'critical',
        title: 'Schema deploy blocked',
        detail: input.schemaSafety.issues
          .filter((i) => i.severity === 'critical')
          .map((i) => i.message)
          .join(' '),
      });
    }

    if (ymylTier === 'high' && input.security && (!input.security.httpsEnforced || !input.security.hstsEnabled)) {
      findings.push({
        severity: 'critical',
        title: 'YMYL transport trust gap',
        detail: 'High YMYL vertical requires HTTPS + HSTS before cite-worthiness can be claimed.',
      });
    }

    if (ymylTier !== 'none' && !input.empirical?.evidenceList.some((e) => e.brandCited)) {
      findings.push({
        severity: 'high',
        title: 'YMYL brand not empirically cited',
        detail: 'Elevated/high YMYL topics without brand citations risk competitor capture in AI answers.',
      });
    }

    return {
      citeWorthiness,
      securityTrust,
      citationIntegrity,
      entityClarity,
      schemaSafety,
      ymylTier,
      findings,
      formula: FORMULA,
      measuredAt: Date.now(),
      confidenceCap,
      signalStatus: {
        security: input.security
          ? input.security.measurementConfidence === 'full'
            ? 'measured'
            : input.security.measurementConfidence === 'cors_limited'
              ? 'inferred'
              : 'not_measured'
          : 'not_measured',
        integrity: input.integrity ? 'measured' : 'not_measured',
        entityClarity: input.empirical ? 'measured' : 'not_measured',
        schema: input.schemaSafety ? 'measured' : 'not_measured',
      },
    };
  }
}

export const aeoTrustPackService = AeoTrustPackService.getInstance();
