import { describe, expect, it } from 'vitest';
import { aeoTrustPackService, detectYmylTier } from '../services/audit/aeoTrustPackService';
import type { SecurityPosture } from '../services/enrichment/publicApisEnrichmentService';
import type { EmpiricalCitationSummary } from '../services/audit/empiricalCitationService';
import type { CitationIntegrityResult } from '../services/audit/citationIntegrityService';
import type { SchemaSafetyResult } from '../services/deployment/schemaSafetyGate';

describe('aeoTrustPackService', () => {
  it('detects YMYL tiers from text', () => {
    expect(detectYmylTier('dental clinic health services')).toBe('high');
    expect(detectYmylTier('insurance quotes')).toBe('elevated');
    expect(detectYmylTier('saas analytics dashboard')).toBe('none');
  });

  it('weights citeWorthiness from four sub-scores', () => {
    const security: SecurityPosture = {
      httpsEnforced: true,
      redirectsToHttps: true,
      hstsEnabled: true,
      cspDetected: true,
      referrerPolicy: true,
      xFrameOptions: true,
      securityTxtPresent: true,
      trustScore: 100,
      measurementConfidence: 'full',
    };

    const empirical: EmpiricalCitationSummary = {
      targetDomain: 'brand.com',
      brandName: 'Brand',
      citationRatePercent: 80,
      queriesCitedCount: 4,
      totalQueriesTested: 5,
      entityClarityScore: 80,
      topCitedCompetitor: '',
      lastAudited: Date.now(),
      evidenceList: [
        {
          id: '1',
          query: 'brand overview',
          intent: 'informational',
          brandCited: true,
          brandRank: 1,
          competitorsCited: [],
          snippet: 'Brand is cited',
          citationConfidence: 90,
        },
      ],
    };

    const integrity: CitationIntegrityResult = {
      integrityScore: 90,
      deadCitationCount: 0,
      spoofRisk: 'low',
      sameAsConflict: false,
      details: [],
      measuredAt: Date.now(),
    };

    const schemaSafety: SchemaSafetyResult = {
      okToDeploy: true,
      severity: 'ok',
      issues: [],
      parsedTypes: ['Organization'],
    };

    const pack = aeoTrustPackService.build({
      security,
      empirical,
      integrity,
      schemaSafety,
      brandName: 'Brand',
      domain: 'brand.com',
      reportText: 'saas product',
    });

    // 0.3*100 + 0.3*90 + 0.2*80 + 0.2*100 = 30+27+16+20 = 93
    expect(pack.citeWorthiness).toBe(93);
    expect(pack.confidenceCap).toBe(100);
    expect(pack.ymylTier).toBe('none');
    expect(pack.formula).toContain('confidenceCap');
    expect(pack.signalStatus.schema).toBe('measured');
  });

  it('caps citeWorthiness when security measurement is CORS-limited', () => {
    const pack = aeoTrustPackService.build({
      security: {
        httpsEnforced: true,
        redirectsToHttps: false,
        hstsEnabled: false,
        cspDetected: false,
        referrerPolicy: false,
        xFrameOptions: false,
        securityTxtPresent: false,
        trustScore: 40,
        measurementConfidence: 'cors_limited',
      },
      empirical: {
        targetDomain: 'brand.com',
        brandName: 'Brand',
        citationRatePercent: 100,
        queriesCitedCount: 3,
        totalQueriesTested: 3,
        entityClarityScore: 100,
        topCitedCompetitor: '',
        lastAudited: Date.now(),
        evidenceList: [
          {
            id: '1',
            query: 'brand',
            intent: 'informational',
            targetDomain: 'brand.com',
            brandCited: true,
            brandRank: 1,
            citedUrl: 'https://brand.com',
            competitorsCited: [],
            snippet: 'Brand',
            citationConfidence: 95,
            timestamp: Date.now(),
          },
        ],
      },
      integrity: {
        integrityScore: 100,
        deadCitationCount: 0,
        spoofRisk: 'low',
        sameAsConflict: false,
        details: [],
        measuredAt: Date.now(),
      },
      schemaSafety: {
        okToDeploy: true,
        severity: 'ok',
        issues: [],
        parsedTypes: ['Organization'],
      },
      reportText: 'saas product',
      domain: 'brand.com',
    });

    // Raw would be 0.3*40 + 0.3*100 + 0.2*100 + 0.2*100 = 12+30+20+20 = 82; capped at 70
    expect(pack.confidenceCap).toBe(70);
    expect(pack.citeWorthiness).toBe(70);
    expect(pack.findings.some((f) => f.title.includes('capped'))).toBe(true);
  });

  it('flags CORS-limited security and blocked schema', () => {
    const pack = aeoTrustPackService.build({
      security: {
        httpsEnforced: false,
        redirectsToHttps: false,
        hstsEnabled: false,
        cspDetected: false,
        referrerPolicy: false,
        xFrameOptions: false,
        securityTxtPresent: false,
        trustScore: 0,
        measurementConfidence: 'cors_limited',
      },
      schemaSafety: {
        okToDeploy: false,
        severity: 'critical',
        issues: [{ code: 'INVALID_JSON', severity: 'critical', message: 'bad json' }],
        parsedTypes: [],
      },
      reportText: 'medical clinic',
      domain: 'clinic.example',
    });

    expect(pack.ymylTier).toBe('high');
    expect(pack.findings.some((f) => f.title.includes('CORS'))).toBe(true);
    expect(pack.findings.some((f) => f.title.includes('Schema deploy blocked'))).toBe(true);
    expect(pack.signalStatus.security).toBe('inferred');
  });
});
