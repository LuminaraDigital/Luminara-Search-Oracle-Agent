import { describe, expect, it } from 'vitest';
import {
  collectScrapedLinks,
  restrictOrganizationSameAs,
  restrictReportJsonLdSameAs,
} from '../services/audit/scrapedSameAs';

const BLOCK = `{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "MoVida",
  "url": "https://movida.com.au",
  "sameAs": [
    "https://facebook.com/movida",
    "https://www.instagram.com/movida/"
  ]
}`;

describe('scraped sameAs', () => {
  it('keeps a sameAs URL only when the scraped page links to it', () => {
    const links = collectScrapedLinks([
      {
        outboundLinks: ['https://www.facebook.com/movida/'],
        rawTextSnippet: 'Home',
      },
    ]);
    const json = restrictOrganizationSameAs(BLOCK, links);
    const parsed = JSON.parse(json) as { sameAs?: string[] };
    expect(parsed.sameAs).toEqual(['https://facebook.com/movida']);
  });

  it('omits sameAs when the scraped page has no matching link', () => {
    const report = `Add this block.\n\`\`\`json\n${BLOCK}\n\`\`\``;
    const out = restrictReportJsonLdSameAs(report, []);
    expect(out).not.toContain('sameAs');
    expect(out).not.toContain('facebook.com');
    expect(out).not.toContain('instagram.com');
    expect(JSON.parse(out.match(/\{[\s\S]*\}/)?.[0] || '{}')).not.toHaveProperty('sameAs');
  });
});
