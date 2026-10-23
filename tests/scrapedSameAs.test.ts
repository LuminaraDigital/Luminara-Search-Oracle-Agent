import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DiffViewerModal } from '../components/audit/DiffViewerModal';
import {
  collectScrapedLinks,
  copyPasteOrganizationSchema,
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

  it('drops a poster or og:image used as logo', () => {
    const poster = 'https://www.luminarasuite.com/intro/poster.jpg';
    const social = 'https://www.luminarasuite.com/og-image.png';
    const block = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Luminara',
      url: 'https://www.luminarasuite.com',
      logo: poster,
      image: social,
    });
    const out = restrictReportJsonLdSameAs(
      `Use this.\n\`\`\`json\n${block}\n\`\`\``,
      [],
      `${poster}\n${social}\nhttps://www.luminarasuite.com\nLuminara`,
    );
    const parsed = JSON.parse(out.match(/```json\s*([\s\S]*?)```/)?.[1] || '{}') as Record<string, unknown>;
    expect(parsed.name).toBe('Luminara');
    expect(parsed).not.toHaveProperty('logo');
    expect(parsed).not.toHaveProperty('image');
  });

  it('keeps a logo file that the scrape actually contains', () => {
    const logo = 'https://www.luminarasuite.com/logo.svg';
    const block = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Luminara',
      url: 'https://www.luminarasuite.com',
      logo,
    });
    const out = restrictReportJsonLdSameAs(`\`\`\`json\n${block}\n\`\`\``, [], `Organization logo ${logo}`);
    const parsed = JSON.parse(out.match(/\{[\s\S]*\}/)?.[0] || '{}') as { logo?: string };
    expect(parsed.logo).toBe(logo);
  });

  it('removes SearchAction and potentialAction', () => {
    const block = `{
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": "Luminara",
      "url": "https://www.luminarasuite.com",
      "potentialAction": {
        "@type": "SearchAction",
        "target": "https://www.luminarasuite.com/search?q={search_term_string}"
      }
    }`;
    const out = restrictReportJsonLdSameAs(
      `\`\`\`json\n${block}\n\`\`\``,
      [],
      'https://www.luminarasuite.com Luminara',
    );
    expect(out).not.toMatch(/SearchAction/);
    expect(out).not.toMatch(/potentialAction/);
  });

  it('uses deterministic Organization JSON-LD when the model block is unsafe', () => {
    const unsafe = copyPasteOrganizationSchema(
      JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Luminara',
        potentialAction: { '@type': 'SearchAction', target: 'https://www.luminarasuite.com/search?q={q}' },
      }),
      'luminarasuite.com',
      'Luminara',
    );
    const parsed = JSON.parse(unsafe) as { '@type': string; name?: string; url: string };
    expect(parsed['@type']).toBe('Organization');
    expect(parsed.name).toBe('Luminara');
    expect(parsed.url).toBe('https://luminarasuite.com');
    expect(unsafe).not.toMatch(/SearchAction|potentialAction|production-ready/i);
  });

  it('labels the copy-paste schema as a draft', () => {
    const html = renderToStaticMarkup(createElement(DiffViewerModal, {
      isOpen: true,
      onClose: () => {},
      remediationPayload: {
        domain: 'example.com',
        title: 'Draft',
        schemaJsonLd: '{"@context":"https://schema.org","@type":"Organization","url":"https://example.com"}',
      },
    }));
    expect(html).toContain('Draft from this audit. Verify before pasting.');
    expect(html).not.toMatch(/production-ready/i);
  });
});
