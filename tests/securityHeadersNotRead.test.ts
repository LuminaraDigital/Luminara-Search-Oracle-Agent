import { describe, expect, it } from 'vitest';
import { aeoTrustPackService } from '../services/audit/aeoTrustPackService';
import { buildEnrichmentPromptSection } from '../services/audit/evidencePromptLabels';
import { buildEnterpriseTrustPack } from '../services/trust/enterpriseTrustPackService';
import type { EnrichedEntityIntelligence } from '../services/enrichment/publicApisEnrichmentService';

type Confidence = 'full' | 'cors_limited';

// The site answered over HTTPS. With cors_limited the browser could not read its headers.
const security = (measurementConfidence: Confidence) => ({
  httpsEnforced: true,
  redirectsToHttps: true,
  hstsEnabled: false,
  cspDetected: false,
  referrerPolicy: false,
  xFrameOptions: false,
  securityTxtPresent: true,
  trustScore: 65,
  measurementConfidence,
});

const enriched = (measurementConfidence: Confidence) =>
  ({
    domain: 'clinic.example',
    brandName: 'Clinic',
    wikidata: null,
    wayback: { hasArchive: false, status: 'unindexed' },
    metadata: null,
    security: security(measurementConfidence),
    sameAsUrls: [],
    timestamp: 1,
  }) as unknown as EnrichedEntityIntelligence;

const findingTitles = (measurementConfidence: Confidence) =>
  aeoTrustPackService
    .build({ security: security(measurementConfidence), reportText: 'medical clinic', domain: 'clinic.example' })
    .findings.map((f) => f.title);

describe('a security check that reached the site but could not read its headers', () => {
  it('raises no HSTS finding, only that the headers were not measured', () => {
    const found = findingTitles('cors_limited');
    expect(found).toContain('Security headers not measured');
    expect(found).not.toContain('Secure connection header missing');
    expect(found).not.toContain('YMYL transport trust gap');
  });

  it('still reports HSTS missing when the headers were read', () => {
    const found = findingTitles('full');
    expect(found).toContain('Secure connection header missing');
    expect(found).toContain('YMYL transport trust gap');
  });

  it('tells the report writer the headers are unknown, not missing', () => {
    const limited = buildEnrichmentPromptSection(enriched('cors_limited'));
    expect(limited).toContain('unknown, not missing');
    expect(limited).not.toContain('(HSTS): missing');
    expect(buildEnrichmentPromptSection(enriched('full'))).toContain('(HSTS): missing');
  });

  it('marks the enterprise HSTS control unknown instead of failed', () => {
    const hsts = (c: Confidence) =>
      buildEnterpriseTrustPack({ domain: 'clinic.example', enriched: enriched(c) }).controls.find((x) => x.id === 'ctrl-hsts');
    expect(hsts('cors_limited')?.status).toBe('unknown');
    expect(hsts('cors_limited')?.detail).toContain('not measured');
    expect(hsts('full')?.status).toBe('fail');
  });

  it('shows Not measured for the header rows on the card', async () => {
    const { createElement } = await import('react');
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { EntityAuthorityCard } = await import('../components/audit/EntityAuthorityCard');
    const render = (c: Confidence) => renderToStaticMarkup(createElement(EntityAuthorityCard, { enriched: enriched(c) }));
    expect(render('cors_limited').match(/Not measured/g)).toHaveLength(2);
    expect(render('cors_limited')).not.toContain('Missing');
    expect(render('full')).toContain('Missing');
    expect(render('full')).not.toContain('Not measured');
  });
});
