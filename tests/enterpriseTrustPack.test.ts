import { describe, it, expect } from 'vitest';
import { buildEnterpriseTrustPack } from '../services/trust/enterpriseTrustPackService';
import type { EnrichedEntityIntelligence } from '../services/enrichment/publicApisEnrichmentService';

const enrichedOk = (): EnrichedEntityIntelligence => ({
  domain: 'example.com',
  brandName: 'Example',
  wikidata: {
    id: 'Q1',
    label: 'Example',
    description: 'test',
    url: 'https://www.wikidata.org/wiki/Q1',
    wikipediaUrl: 'https://en.wikipedia.org/wiki/Example',
  },
  wayback: {
    hasArchive: true,
    status: 'established',
  },
  metadata: null,
  security: {
    httpsEnforced: true,
    redirectsToHttps: true,
    hstsEnabled: true,
    cspDetected: false,
    referrerPolicy: false,
    xFrameOptions: false,
    securityTxtPresent: false,
    trustScore: 80,
    measurementConfidence: 'full',
  },
  sameAsUrls: ['https://www.wikidata.org/wiki/Q1'],
  timestamp: Date.now(),
});

describe('enterpriseTrustPackService', () => {
  it('builds a non-certification trust pack with controls and provenance', () => {
    const pack = buildEnterpriseTrustPack({
      domain: 'example.com',
      trustPack: {
        citeWorthiness: 72,
        securityTrust: 80,
        citationIntegrity: 75,
        entityClarity: 70,
        schemaSafety: 90,
        ymylTier: 'none',
        findings: [],
        formula: 'x',
        measuredAt: Date.now(),
        confidenceCap: 100,
        signalStatus: {
          security: 'measured',
          integrity: 'measured',
          entityClarity: 'measured',
          schema: 'measured',
        },
      },
      empirical: {
        targetDomain: 'example.com',
        brandName: 'Example',
        totalQueriesTested: 3,
        queriesCitedCount: 2,
        citationRatePercent: 67,
        topCitedCompetitor: null,
        evidenceList: [],
        entityClarityScore: 70,
        lastAudited: Date.now(),
      },
      enriched: enrichedOk(),
      requireTgAuth: true,
    });

    expect(pack.meta.disclaimer).toBe('controls_checklist_not_certification');
    expect(pack.meta.product).toBe('Luminara Suite');
    expect(pack.controls.length).toBeGreaterThanOrEqual(6);
    expect(pack.datasetProvenance.some((d) => d.id === 'ds-tavily')).toBe(true);
    expect(pack.promptVolumeEstimates.some((p) => p.method === 'observed')).toBe(true);
    expect(pack.promptVolumeEstimates.some((p) => p.method === 'estimated')).toBe(true);
    expect(pack.eeatSignals.some((e) => e.system === 'trust')).toBe(true);
    expect(pack.readinessScore).toBeGreaterThan(0);
    expect(pack.readinessScore).toBeLessThanOrEqual(100);
  });

  it('caps readiness when HTTPS trust veto fails', () => {
    const base = enrichedOk();
    const pack = buildEnterpriseTrustPack({
      domain: 'insecure.example',
      enriched: {
        ...base,
        domain: 'insecure.example',
        security: {
          ...base.security,
          httpsEnforced: false,
          redirectsToHttps: false,
          hstsEnabled: false,
          trustScore: 20,
        },
      },
    });
    expect(pack.readinessScore).toBeLessThanOrEqual(55);
  });
});
