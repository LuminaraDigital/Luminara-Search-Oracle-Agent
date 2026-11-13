import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditSecurityOnEdge } from '../worker/sentinel';
import { handleEntityEnrichment } from '../worker/enrichmentService';
import type { Env } from '../worker/env';
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

  it('does not cache the Worker enrichment when the security check reached nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cloudflare-dns.com')) {
        const answer = url.includes('type=AAAA') ? [] : [{ type: 1, data: '104.21.8.8' }];
        return new Response(JSON.stringify({ Status: 0, Answer: answer }), { status: 200 });
      }
      throw new TypeError('network down');
    }));
    const put = vi.fn(async () => undefined);
    const env = { LUMINARA_KV: { get: async () => null, put } } as unknown as Env;
    const res = await handleEntityEnrichment(new Request('https://luminarasuite.com/api/enrichment/entity?domain=example.com'), env);
    const body = (await res.json()) as { data: EnrichedEntityIntelligence };
    expect(body.data.security.measurementConfidence).toBe('failed');
    expect(put).not.toHaveBeenCalled();
  });

  it('measures again instead of serving a cached Worker check that reached nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('cloudflare-dns.com')) {
        const answer = url.includes('type=AAAA') ? [] : [{ type: 1, data: '104.21.8.8' }];
        return new Response(JSON.stringify({ Status: 0, Answer: answer }), { status: 200 });
      }
      throw new TypeError('network down');
    }));
    const stale = { domain: 'example.com', security: { measurementConfidence: 'failed', trustScore: 0 } };
    const env = { LUMINARA_KV: { get: async () => stale, put: vi.fn(async () => undefined) } } as unknown as Env;
    const res = await handleEntityEnrichment(new Request('https://luminarasuite.com/api/enrichment/entity?domain=example.com'), env);
    const body = (await res.json()) as { cached: boolean };
    expect(body.cached).toBe(false);
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

describe('enterprise trust pack with no security data', () => {
  it('marks HTTPS unknown with no veto when enrichment is missing', async () => {
    const { buildEnterpriseTrustPack } = await import('../services/trust/enterpriseTrustPackService');
    const pack = buildEnterpriseTrustPack({ domain: 'acme.example' });
    expect(pack.controls.find((c) => c.id === 'ctrl-target-https')?.status).toBe('unknown');
    const eeat = pack.eeatSignals.find((s) => s.id === 'eeat-trust-https');
    expect(eeat?.status).toBe('unknown');
    expect(eeat?.veto).toBe(false);
  });
});
