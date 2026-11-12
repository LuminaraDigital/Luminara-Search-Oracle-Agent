import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditSecurityOnEdge } from '../worker/sentinel';
import { aeoTrustPackService } from '../services/audit/aeoTrustPackService';
import { buildEnrichmentPromptSection } from '../services/audit/evidencePromptLabels';
import type { EnrichedEntityIntelligence } from '../services/enrichment/publicApisEnrichmentService';

afterEach(() => vi.unstubAllGlobals());

describe('a security check that cannot reach the site', () => {
  it('reports nothing measured instead of a 40-point base score', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('network down');
    }));
    const posture = await auditSecurityOnEdge('example.com');
    expect(posture.measurementConfidence).toBe('failed');
    expect(posture.trustScore).toBe(0);
    expect(posture.httpsEnforced).toBe(false);
  });

  it('reports nothing measured for a host it refuses to probe', async () => {
    const posture = await auditSecurityOnEdge('localhost');
    expect(posture).toMatchObject({ measurementConfidence: 'failed', trustScore: 0, httpsEnforced: false });
  });

  it('adds nothing to cite-worthiness even if a score is attached', () => {
    const pack = aeoTrustPackService.build({
      security: {
        httpsEnforced: true,
        redirectsToHttps: true,
        hstsEnabled: true,
        cspDetected: true,
        referrerPolicy: true,
        xFrameOptions: true,
        securityTxtPresent: true,
        trustScore: 100,
        measurementConfidence: 'failed',
      },
      domain: 'acme.example',
    });
    expect(pack.securityTrust).toBe(0);
  });

  it('tells the report writer the signals are unknown, not missing', () => {
    const entity = {
      domain: 'acme.example',
      brandName: 'Acme',
      wikidata: null,
      wayback: { hasArchive: false, status: 'unindexed' },
      security: {
        httpsEnforced: false,
        redirectsToHttps: false,
        hstsEnabled: false,
        cspDetected: false,
        referrerPolicy: false,
        xFrameOptions: false,
        securityTxtPresent: false,
        trustScore: 0,
        measurementConfidence: 'failed',
      },
      sameAsUrls: [],
      timestamp: 1,
    } as unknown as EnrichedEntityIntelligence;
    const text = buildEnrichmentPromptSection(entity);
    expect(text).toContain('HTTPS and security headers are unknown');
    expect(text).not.toContain('HTTPS missing');
  });
});

describe('EntityAuthorityCard with an unreachable site', () => {
  it('shows not measured instead of a score or a SECURE badge', async () => {
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { EntityAuthorityCard } = await import('../components/audit/EntityAuthorityCard');
    const enriched = {
      domain: 'acme.example',
      brandName: 'Acme',
      wikidata: null,
      wayback: { hasArchive: false, status: 'unindexed' },
      security: {
        httpsEnforced: false,
        redirectsToHttps: false,
        hstsEnabled: false,
        cspDetected: false,
        referrerPolicy: false,
        xFrameOptions: false,
        securityTxtPresent: false,
        trustScore: 0,
        measurementConfidence: 'failed',
      },
      sameAsUrls: [],
      timestamp: 1,
    } as unknown as EnrichedEntityIntelligence;
    const html = renderToStaticMarkup(createElement(EntityAuthorityCard, { enriched }));
    expect(html).toContain('Not measured');
    expect(html).toContain('security check could not measure this site');
    expect(html).not.toContain('SECURE');
    expect(html).not.toContain('Open APIs Verified');
    expect(html).not.toContain('0/100');
  });
});

describe('trust packs with an unreachable site', () => {
  const failedSecurity = {
    httpsEnforced: false,
    redirectsToHttps: false,
    hstsEnabled: false,
    cspDetected: false,
    referrerPolicy: false,
    xFrameOptions: false,
    securityTxtPresent: false,
    trustScore: 0,
    measurementConfidence: 'failed' as const,
  };

  it('raises no HTTPS or HSTS finding, only that the check did not run', () => {
    const pack = aeoTrustPackService.build({
      security: failedSecurity,
      reportText: 'dental clinic health services',
      domain: 'acme.example',
    });
    const titles = pack.findings.map((f) => f.title);
    expect(titles).toContain('Security check could not reach the site');
    expect(titles).not.toContain('HTTPS not enforced');
    expect(titles).not.toContain('Secure connection header missing');
    expect(titles).not.toContain('YMYL transport trust gap');
  });

  it('still reports HTTPS missing when it was measured', () => {
    const pack = aeoTrustPackService.build({
      security: { ...failedSecurity, measurementConfidence: 'full', trustScore: 40 },
      domain: 'acme.example',
    });
    expect(pack.findings.map((f) => f.title)).toContain('HTTPS not enforced');
  });

  it('marks enterprise HTTPS controls unknown and never vetoes on them', async () => {
    const { buildEnterpriseTrustPack } = await import('../services/trust/enterpriseTrustPackService');
    const pack = buildEnterpriseTrustPack({
      domain: 'acme.example',
      enriched: {
        domain: 'acme.example',
        brandName: 'Acme',
        wikidata: null,
        wayback: { hasArchive: false, status: 'unindexed' },
        metadata: null,
        security: failedSecurity,
        sameAsUrls: [],
        timestamp: 1,
      } as unknown as EnrichedEntityIntelligence,
    });
    const https = pack.controls.find((c) => c.id === 'ctrl-target-https');
    const hsts = pack.controls.find((c) => c.id === 'ctrl-hsts');
    const eeat = pack.eeatSignals.find((s) => s.id === 'eeat-trust-https');
    expect(https?.status).toBe('unknown');
    expect(https?.detail).toMatch(/not measured/);
    expect(hsts?.status).toBe('unknown');
    expect(eeat?.status).toBe('unknown');
    expect(eeat?.veto).toBe(false);
  });
});
