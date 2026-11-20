import { describe, expect, it } from 'vitest';
import {
  formatPublicProfile,
  htmlToVisibleText,
  reportFromAuditPages,
  reportPublicProfile,
} from '../services/audit/publicProfileMatch';

const SCHEMA = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'RealEstateAgent',
  name: 'Harbour and Co',
  telephone: '+61 3 9999 8888',
  address: { '@type': 'PostalAddress', streetAddress: '12 Harbour Street', addressLocality: 'Richmond' },
  areaServed: 'Richmond',
});

const PAGE = `<!DOCTYPE html><html><head><title>Harbour and Co</title>
<script type="application/ld+json">${SCHEMA}</script>
<script>var trap = "0411111111";</script>
</head><body>
<p>Harbour and Co sells homes in Richmond.</p>
<p>Visit 12 Harbour Street or call 03 9999 8888.</p>
</body></html>`;

describe('public profile match', () => {
  it('matches name, phone, address, and service area that are on the page', () => {
    const visible = htmlToVisibleText(PAGE);
    expect(visible.text).not.toContain('0411111111');
    expect(visible.text).toContain('Harbour and Co');
    const report = reportPublicProfile({
      pageRead: true,
      textComplete: true,
      title: 'Harbour and Co',
      visibleText: `${visible.text} ${visible.tels.join(' ')}`,
      jsonLd: [SCHEMA],
    });
    expect(report.signals).toMatchObject({
      hasRealEstateAgent: true,
      name: 'match',
      phone: 'match',
      address: 'match',
      serviceArea: 'match',
    });
    expect(report.nextFix).toBeNull();
    const gbp = report.checks.find((check) => check.id === 'gbp_api');
    expect(gbp?.status).toBe('not_measured');
    expect(gbp?.detail).toContain('does not call the Google Business Profile API');
    expect(formatPublicProfile(report)).toContain('Estimated: none');
  });

  it('flags a missing RealEstateAgent and does not invent a phone mismatch from a short excerpt', () => {
    const report = reportFromAuditPages([{
      title: 'Harbour and Co',
      rawTextSnippet: 'Homes for sale.',
      schemasFound: [{ rawJson: JSON.stringify({ '@type': 'LocalBusiness', name: 'Harbour and Co', telephone: '0399998888' }) }],
    }]);
    expect(report.signals.hasRealEstateAgent).toBe(false);
    expect(report.signals.phone).toBe('not_measured');
    expect(report.nextFix).toContain('RealEstateAgent JSON-LD');
  });

  it('does not invent a phone mismatch from a long excerpt that omits the number', () => {
    const report = reportFromAuditPages([{
      title: 'Harbour and Co',
      rawTextSnippet: 'Homes for sale in Richmond. '.repeat(40),
      schemasFound: [{ rawJson: JSON.stringify({ '@type': 'RealEstateAgent', name: 'Harbour and Co', telephone: '03 9999 8888' }) }],
    }]);
    expect(report.signals.name).toBe('match');
    expect(report.signals.phone).toBe('not_measured');
  });

  it('calls a phone mismatch only when the page text is complete and the number is absent', () => {
    const report = reportPublicProfile({
      pageRead: true,
      textComplete: true,
      title: 'Harbour and Co',
      visibleText: `${'Harbour and Co serves Richmond from 12 Harbour Street. '.repeat(8)}`,
      jsonLd: [SCHEMA],
    });
    expect(report.signals.phone).toBe('mismatch');
    expect(report.signals.name).toBe('match');
    expect(report.nextFix).toContain('same phone');
  });

  it('leaves every comparison Not measured when the page was not read', () => {
    const report = reportPublicProfile({ pageRead: false, textComplete: false });
    expect(report.nextFix).toBeNull();
    expect(report.checks.every((check) => check.status === 'not_measured')).toBe(true);
    expect(report.signals.hasRealEstateAgent).toBeNull();
  });
});
