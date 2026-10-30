import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import FreeToolPage from '../components/marketing/freeTools/FreeToolPage';
import { AppView } from '../types';
import { resolveAppView } from '../utils/marketingRoutes';
import { MARKETING_SHELL_BY_PATH, marketingPageForPath } from '../services/marketing/pageMeta';
import {
  FREE_TOOLS,
  FREE_TOOLS_HUB,
  FREE_TOOLS_PATH,
  freeToolsPageForPath,
} from '../services/marketing/freeTools';
import { PUBLIC_APP_VIEWS } from '../services/auth/useAppAuth';
import { LLMS_TXT, SITEMAP_XML } from '../worker/crawlDocuments';

type JsonLdNode = { '@type': string; '@id'?: string; mainEntity?: unknown[]; itemListElement?: unknown[]; isAccessibleForFree?: boolean };

const graphNodes = (path: string) => MARKETING_SHELL_BY_PATH[path].jsonLd['@graph'] as JsonLdNode[];
const ALL_PATHS = [FREE_TOOLS_PATH, ...FREE_TOOLS.map((tool) => tool.path)];
const EM_DASH = String.fromCharCode(0x2014);

describe('free tools pages', () => {
  it('routes the hub and every tool, and nothing else under /free-tools', () => {
    for (const path of ALL_PATHS) {
      expect(resolveAppView(path, ''), path).toBe(AppView.FREE_TOOLS);
      expect(resolveAppView(`${path}/`, ''), path).toBe(AppView.FREE_TOOLS);
    }
    expect(freeToolsPageForPath(FREE_TOOLS_PATH)).toEqual({ tool: null });
    for (const tool of FREE_TOOLS) expect(freeToolsPageForPath(`${tool.path}/`)).toEqual({ tool });
    expect(resolveAppView('/free-tools/unknown', '')).toBe(AppView.NOT_FOUND);
    // A stray #FREE_TOOLS hash on / resolves the view but has no page, so App renders Not Found.
    expect(freeToolsPageForPath('/')).toBeNull();
    expect(freeToolsPageForPath('/free-tools/unknown')).toBeNull();
    // Guests reach these pages only because the view is public.
    expect(PUBLIC_APP_VIEWS.has(AppView.FREE_TOOLS)).toBe(true);
    expect(marketingPageForPath('/free-tools/unknown')).toBeNull();
  });

  it('gives every path its own shell, FAQ JSON-LD, sitemap entry and llms.txt line', () => {
    for (const path of ALL_PATHS) {
      const shell = MARKETING_SHELL_BY_PATH[path];
      expect(shell, path).toBeDefined();
      expect(shell.title.length, path).toBeLessThanOrEqual(60);
      expect(shell.title.endsWith(' | Luminara Suite'), path).toBe(true);
      expect(shell.description.length, path).toBeLessThanOrEqual(160);
      expect(shell.robots).toBeUndefined();
      expect(SITEMAP_XML).toContain(`<loc>https://www.luminarasuite.com${path}</loc>`);
      expect(LLMS_TXT).toContain(`https://www.luminarasuite.com${path}\n`);
      const faq = graphNodes(path).find((node) => node['@type'] === 'FAQPage');
      expect(faq?.['@id']).toBe(`https://www.luminarasuite.com${path}#faq`);
    }
    expect(graphNodes(FREE_TOOLS_PATH).find((node) => node['@type'] === 'ItemList')?.itemListElement).toHaveLength(FREE_TOOLS.length);
  });

  it('puts the tool copy and every FAQ in the crawler HTML', () => {
    for (const tool of FREE_TOOLS) {
      const shell = MARKETING_SHELL_BY_PATH[tool.path];
      expect(shell.crawlerBody).toContain(`<h1>${tool.h1}</h1>`);
      for (const item of tool.faq) expect(shell.crawlerBody).toContain(item.question);
      expect(graphNodes(tool.path).find((node) => node['@type'] === 'FAQPage')?.mainEntity).toHaveLength(tool.faq.length);
      expect(graphNodes(tool.path).find((node) => node['@type'] === 'WebApplication')?.isAccessibleForFree).toBe(true);
    }
    for (const item of FREE_TOOLS_HUB.faq) expect(MARKETING_SHELL_BY_PATH[FREE_TOOLS_PATH].crawlerBody).toContain(item.question);
  });

  it('keeps the copy free of em dashes and of price figures', () => {
    const copy = JSON.stringify([FREE_TOOLS, FREE_TOOLS_HUB]);
    expect(copy).not.toContain(EM_DASH);
    expect(copy).not.toMatch(/\$\d|A\$|per month|\/mo\b/);
  });

  it('renders the hub and each tool page with its output and the live check', () => {
    const hub = renderToStaticMarkup(createElement(FreeToolPage, { tool: null, onFullAudit: () => undefined }));
    expect(hub).toContain(FREE_TOOLS_HUB.h1);
    expect(hub).toContain('id="free-tools-domain"');
    for (const tool of FREE_TOOLS) expect(hub).toContain(`href="${tool.path}"`);

    // The first lines of each tool's generated output, as rendered (HTML-escaped) in the output panel.
    const OUTPUT: Record<string, string> = {
      'serp-preview': '&lt;title&gt;Hawthorn real estate agent',
      'robots-txt-generator': 'User-agent: *',
      'llms-txt-generator': '# Example Realty',
      'schema-generator': '&lt;script type=&quot;application/ld+json&quot;&gt;',
    };
    for (const tool of FREE_TOOLS) {
      const html = renderToStaticMarkup(createElement(FreeToolPage, { tool, onFullAudit: () => undefined }));
      expect(html, tool.id).toContain(tool.h1);
      expect(html, tool.id).toContain(OUTPUT[tool.id]);
      expect(html, tool.id).toContain('id="free-tools-domain"');
      expect(html, tool.id).not.toContain(`href="${tool.path}"`);
    }
  });
});
