import { describe, expect, it } from 'vitest';
import {
  checkDescription,
  checkTitle,
  serpBreadcrumb,
  serpHeadHtml,
  textWidthPx,
  truncateToPx,
  TITLE_FONT_PX,
  TITLE_MAX_PX,
} from '../services/freeTools/serpPreview';
import { AI_BOTS, buildRobotsTxt, presetBlocks } from '../services/freeTools/robotsTxt';
import { buildLlmsTxt } from '../services/freeTools/llmsTxt';
import { buildSchemaGraph, schemaScriptTag, type SchemaOptions } from '../services/freeTools/schemaJsonLd';
import { toHttpUrl } from '../services/freeTools/httpUrl';
import { evaluateLlmCrawlerReadiness, LLM_CRAWLER_BOTS } from '../services/audit/llmCrawlerReadiness';

function readiness(robotsTxt: string | null, llmsTxt: string | null) {
  const report = evaluateLlmCrawlerReadiness({
    robotsTxt,
    robotsHttpStatus: robotsTxt === null ? 404 : 200,
    llmsTxt,
    llmsHttpStatus: llmsTxt === null ? 404 : 200,
  });
  return Object.fromEntries(report.checks.map((c) => [c.id, c.status]));
}

describe('toHttpUrl', () => {
  it('adds https to a bare host and keeps http(s) links', () => {
    expect(toHttpUrl('example.com/a')).toBe('https://example.com/a');
    expect(toHttpUrl('example.com:8080/a')).toBe('https://example.com:8080/a');
    expect(toHttpUrl('http://example.com')).toBe('http://example.com/');
  });

  it('rejects other schemes instead of prefixing them', () => {
    for (const bad of ['ftp://example.com', 'javascript:alert(1)', 'mailto:a@b.com', '', '  ', 'two words']) {
      expect(toHttpUrl(bad)).toBeNull();
    }
  });
});

describe('serp preview', () => {
  it('measures wide letters wider than narrow ones', () => {
    expect(textWidthPx('WWWW', 20)).toBeGreaterThan(textWidthPx('iiii', 20) * 3);
    expect(textWidthPx('', 20)).toBe(0);
  });

  it('keeps a title that fits and cuts one that does not', () => {
    expect(truncateToPx('Short title', TITLE_FONT_PX, TITLE_MAX_PX)).toEqual({ text: 'Short title', truncated: false });
    const long = 'Melbourne real estate agents who sell homes fast in every inner east suburb';
    const cut = truncateToPx(long, TITLE_FONT_PX, TITLE_MAX_PX);
    expect(cut.truncated).toBe(true);
    expect(cut.text.endsWith('...')).toBe(true);
    expect(textWidthPx(cut.text, TITLE_FONT_PX)).toBeLessThanOrEqual(TITLE_MAX_PX);
  });

  it('gives a verdict per field', () => {
    expect(checkTitle('').verdict).toBe('empty');
    expect(checkTitle('Hi').verdict).toBe('short');
    expect(checkTitle('Hawthorn real estate agent | Smith & Co').verdict).toBe('good');
    expect(checkTitle('W'.repeat(40)).verdict).toBe('truncated');
    expect(checkDescription('x'.repeat(200), 'mobile').verdict).toBe('truncated');
    expect(checkDescription('A plain, useful description that tells a vendor what the agency does well.', 'desktop').verdict).toBe('good');
  });

  it('builds the breadcrumb Google shows', () => {
    expect(serpBreadcrumb('https://www.example.com.au/suburbs/hawthorn/')).toEqual({
      site: 'example.com.au',
      crumbs: ['suburbs', 'hawthorn'],
    });
    expect(serpBreadcrumb('example.com').site).toBe('example.com');
    expect(serpBreadcrumb('').site).toBe('example.com');
  });

  it('escapes the head tags it hands back', () => {
    expect(serpHeadHtml('A <b> & "c"', 'd "e"')).toBe(
      '<title>A &lt;b&gt; &amp; &quot;c&quot;</title>\n<meta name="description" content="d &quot;e&quot;">',
    );
    expect(serpHeadHtml('Only a title', '  ')).toBe('<title>Only a title</title>');
  });
});

describe('robots.txt generator', () => {
  it('covers every crawler the audit checks', () => {
    const agents = AI_BOTS.map((bot) => bot.agent);
    for (const bot of LLM_CRAWLER_BOTS) expect(agents).toContain(bot);
    expect(new Set(agents).size).toBe(agents.length);
  });

  it('allows every AI crawler and passes our own crawler check', () => {
    const txt = buildRobotsTxt({ blocked: presetBlocks('allow_all'), disallowPaths: [], sitemapUrl: 'https://example.com/sitemap.xml' });
    expect(txt).toContain('User-agent: *\nAllow: /');
    expect(txt).not.toContain('Disallow: /\n');
    expect(txt.trimEnd().endsWith('Sitemap: https://example.com/sitemap.xml')).toBe(true);
    expect(readiness(txt, null).ai_bot_directives).toBe('pass');
  });

  it('blocks only training crawlers on the answers preset', () => {
    const txt = buildRobotsTxt({ blocked: presetBlocks('answers_not_training'), disallowPaths: [], sitemapUrl: '' });
    expect(txt).toMatch(/User-agent: GPTBot\nDisallow: \//);
    expect(txt).toMatch(/User-agent: OAI-SearchBot\nAllow: \//);
    expect(txt).not.toContain('Sitemap:');
  });

  it('fails our own crawler check when every AI crawler is blocked', () => {
    const txt = buildRobotsTxt({ blocked: presetBlocks('block_all_ai'), disallowPaths: [], sitemapUrl: '' });
    expect(readiness(txt, null).ai_bot_directives).toBe('fail');
  });

  it('repeats private paths in each allowed group and drops junk input', () => {
    const txt = buildRobotsTxt({
      blocked: {},
      disallowPaths: ['admin/', '/admin/', ' ', 'has space'],
      sitemapUrl: 'javascript:alert(1)',
    });
    expect(txt).toContain('User-agent: *\nDisallow: /admin/\n');
    expect(txt).toContain('User-agent: ClaudeBot\nDisallow: /admin/\n');
    expect(txt.match(/Disallow: \/admin\//g)?.length).toBe(AI_BOTS.length + 1);
    expect(txt).not.toContain('has space');
    expect(txt).not.toContain('Sitemap:');
  });
});

describe('llms.txt generator', () => {
  const options = {
    siteName: 'Smith & Co Real Estate',
    summary: 'Independent agency selling homes in Hawthorn and Kew.',
    details: 'We publish suburb guides and recent sales.',
    sections: [
      {
        heading: 'Key pages',
        links: [
          { title: 'Hawthorn guide', url: 'example.com/hawthorn', note: 'Prices and schools' },
          { title: '', url: 'https://example.com/empty', note: '' },
          { title: 'Bad', url: 'ftp://example.com', note: '' },
        ],
      },
      { heading: 'Empty', links: [] },
    ],
  };

  it('writes the llmstxt.org layout and passes our own structure check', () => {
    const txt = buildLlmsTxt(options);
    expect(txt).toBe(
      '# Smith & Co Real Estate\n\n> Independent agency selling homes in Hawthorn and Kew.\n\nWe publish suburb guides and recent sales.\n\n## Key pages\n- [Hawthorn guide](https://example.com/hawthorn): Prices and schools\n',
    );
    const checks = readiness(null, txt);
    expect(checks.llms_txt).toBe('pass');
    expect(checks.llms_structure).toBe('pass');
  });

  it('strips brackets that would break a link', () => {
    const txt = buildLlmsTxt({
      ...options,
      sections: [{ heading: 'Pages', links: [{ title: 'A [b]', url: 'https://example.com', note: '' }] }],
    });
    expect(txt).toContain('- [A b](https://example.com/)');
  });
});

describe('schema generator', () => {
  const base: SchemaOptions = {
    type: 'RealEstateAgent',
    name: 'Smith & Co',
    url: 'smithco.com.au',
    description: '',
    telephone: '03 9000 0000',
    email: '',
    street: '',
    locality: 'Hawthorn',
    region: 'VIC',
    postcode: '3122',
    country: 'AU',
    areaServed: ['Hawthorn', ' ', 'Kew'],
    sameAs: ['https://www.linkedin.com/company/smithco', 'not a url with spaces'],
    faq: [
      { question: 'Do you charge for an appraisal?', answer: 'No.' },
      { question: 'Half filled', answer: '' },
    ],
  };

  it('writes only the fields the user typed', () => {
    const graph = buildSchemaGraph(base) as { '@graph': Record<string, unknown>[] };
    const [agent, faq] = graph['@graph'];
    expect(agent).toEqual({
      '@type': 'RealEstateAgent',
      '@id': 'https://smithco.com.au/#business',
      name: 'Smith & Co',
      url: 'https://smithco.com.au/',
      telephone: '03 9000 0000',
      address: { '@type': 'PostalAddress', addressLocality: 'Hawthorn', addressRegion: 'VIC', postalCode: '3122', addressCountry: 'AU' },
      areaServed: [{ '@type': 'Place', name: 'Hawthorn' }, { '@type': 'Place', name: 'Kew' }],
      sameAs: ['https://www.linkedin.com/company/smithco'],
    });
    expect(faq['@type']).toBe('FAQPage');
    expect((faq.mainEntity as unknown[]).length).toBe(1);
    expect(JSON.stringify(graph)).not.toMatch(/rating|review/i);
  });

  it('leaves out the address and FAQ when they are empty', () => {
    const graph = buildSchemaGraph({ ...base, locality: '', region: '', postcode: '', country: '', faq: [] }) as {
      '@graph': Record<string, unknown>[];
    };
    expect(graph['@graph']).toHaveLength(1);
    expect(graph['@graph'][0].address).toBeUndefined();
  });

  it('cannot close its own script tag', () => {
    const tag = schemaScriptTag(buildSchemaGraph({ ...base, name: '</script><script>alert(1)</script>' }));
    expect(tag.match(/<\/script>/g)?.length).toBe(1);
    expect(tag.startsWith('<script type="application/ld+json">')).toBe(true);
  });
});
