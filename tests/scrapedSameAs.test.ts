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

  it('drops a phone, logo, and address the scrape does not contain', () => {
    const block = `{
      "@context": "https://schema.org",
      "@type": "Organization",
      "name": "MoVida",
      "url": "https://www.movida.com.au",
      "telephone": "+61-3-1234-5678",
      "logo": "https://www.movida.com.au/logo.png",
      "address": { "@type": "PostalAddress", "streetAddress": "1 Hosier Lane" }
    }`;
    const evidence = 'Title: MoVida\nhttps://www.movida.com.au\n';
    const out = restrictReportJsonLdSameAs(`Use this.\n\`\`\`json\n${block}\n\`\`\``, [], evidence);
    const fence = out.match(/```json\s*([\s\S]*?)```/)?.[1] || '';
    const parsed = JSON.parse(fence) as Record<string, unknown>;
    expect(parsed.name).toBe('MoVida');
    expect(parsed.url).toBe('https://www.movida.com.au');
    expect(parsed).not.toHaveProperty('telephone');
    expect(parsed).not.toHaveProperty('logo');
    expect(parsed).not.toHaveProperty('address');
    expect(fence).not.toContain('REPLACE_ME');
    expect(fence).not.toContain('1234');
    expect(out).toContain('REPLACE_ME');
  });
});
