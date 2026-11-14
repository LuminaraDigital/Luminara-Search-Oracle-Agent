import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AuditReportArticle } from '../components/audit/AuditReportArticle';
import { playbookAuditorAgent } from '../services/agentCore/agents/playbookAuditorAgent';
import { toCrewPage } from '../services/agentCore/agents/scoutAgent';
import { criticReflectionEngine } from '../services/agentCore/criticReflectionEngine';
import type { ScrapedPageEvidence, SerpEvidenceItem } from '../services/agentCore/types';
import type { BoardFinding } from '../services/audit/findingBoardService';
import { contentDistiller, keepDiscoveredSchemas } from '../services/scraping/contentDistiller';
import type { ScrapedPageEvidence as ProviderPage } from '../services/scraping/unifiedScraper';

const noop = () => {};
const ORG = '{"@context":"https://schema.org","@type":"Organization","name":"Example"}';
const BROKEN = '{"@context": "https://schema.org", "@type": "Product",';

function ldBlock(body: string): string {
  return `<script type="application/ld+json">${body}</script>`;
}

function page(partial: Partial<ScrapedPageEvidence> = {}): ScrapedPageEvidence {
  return {
    url: 'https://example.com',
    title: 'Example',
    h1s: ['Example'],
    schemasFound: [],
    wordCount: 400,
    rawTextSnippet: 'Example publishes enough product detail for a real page audit.',
    source: 'patchright',
    ...partial,
  };
}

const orgSchema = { type: 'Organization', rawJson: ORG, isValid: true };

const serp: SerpEvidenceItem = {
  query: 'example official',
  engine: 'tavily',
  title: 'Example official site',
  url: 'https://example.com/about',
  snippet: 'Example publishes product detail.',
  brandMentioned: true,
};

async function audit(pages: ScrapedPageEvidence[]) {
  return playbookAuditorAgent.execute('AEO', pages, [serp], null, noop);
}

function byId(findings: { id: string }[], id: string) {
  return findings.find((finding) => finding.id === id);
}

describe('distiller counts JSON-LD blocks that fail to parse', () => {
  it('counts a broken block and keeps the working one', () => {
    const html = `<html><head>${ldBlock(ORG)}${ldBlock(BROKEN)}</head><body><p>Hello</p></body></html>`;
    const result = contentDistiller.distill(html, '');
    expect(result.schemaParseFailures).toBe(1);
    expect(result.schemaTypes).toEqual(['Organization']);
  });

  it('omits the count when every block parses or there are none', () => {
    expect(contentDistiller.distill(`<html><head>${ldBlock(ORG)}</head></html>`, '').schemaParseFailures).toBeUndefined();
    expect(contentDistiller.distill('<html><body><p>Hi</p></body></html>', '').schemaParseFailures).toBeUndefined();
  });

  it('counts the same broken block once when it is in the page and in schemaHtml', () => {
    const html = `<html><head>${ldBlock(BROKEN)}</head><body><p>Hello</p></body></html>`;
    expect(contentDistiller.distill(html, '', { schemaHtml: html }).schemaParseFailures).toBe(1);
  });

  it('keeps the larger count when discovered schemas are merged', () => {
    const fresh = contentDistiller.distill('<html><body><p>Hi</p></body></html>', '');
    const prior = contentDistiller.distill(`<html><head>${ldBlock(ORG)}${ldBlock(BROKEN)}${ldBlock('{nope')}</head></html>`, '');
    expect(prior.schemaParseFailures).toBe(2);
    expect(keepDiscoveredSchemas(fresh, prior).schemaParseFailures).toBe(2);
    expect(keepDiscoveredSchemas({ ...fresh, schemaParseFailures: 3 }, prior).schemaParseFailures).toBe(3);
  });

  it('copies the count onto the crew page', () => {
    const distilled = contentDistiller.distill(`<html><head>${ldBlock(BROKEN)}</head><body><p>Hello</p></body></html>`, '');
    const provider = { url: 'https://example.com', markdown: 'Hello', distilled, providerUsed: 'direct' } as unknown as ProviderPage;
    expect(toCrewPage(provider, 'https://example.com').schemaParseFailures).toBe(1);
    const clean = { ...provider, distilled: contentDistiller.distill('<html><body>Hi</body></html>', '') } as ProviderPage;
    expect(toCrewPage(clean, 'https://example.com').schemaParseFailures).toBeUndefined();
  });
});

describe('a broken schema block is reported as broken', () => {
  it('case 1: a broken block alone keeps finding-schema-org with unreadable wording', async () => {
    const { findings } = await audit([page({ schemaParseFailures: 1 })]);
    const found = byId(findings, 'finding-schema-org');
    expect(found?.description).toContain('A schema block is present on https://example.com but cannot be read.');
    expect(byId(findings, 'finding-schema-org-broken')).toBeUndefined();
  });

  it('case 2: a good Organization block plus a broken one gives only the informational finding', async () => {
    const { findings } = await audit([page({ schemasFound: [orgSchema], schemaParseFailures: 1 })]);
    expect(byId(findings, 'finding-schema-org')).toBeUndefined();
    const found = byId(findings, 'finding-schema-org-broken');
    expect(found?.title).toBe('A schema block cannot be read on https://example.com');
    expect(found?.severity).toBe('low');
  });

  it('case 3: no schema keeps today wording', async () => {
    const { findings } = await audit([page()]);
    const found = byId(findings, 'finding-schema-org');
    expect(found?.description).toBe('Tags on the page: none. A business identity tag was not among them.');
    expect(found?.description).not.toContain('cannot be read');
  });

  it('case 4: partial finding says the other page has an unreadable block', async () => {
    const { findings } = await audit([
      page({ schemasFound: [orgSchema] }),
      page({ url: 'https://example.com/about', schemaParseFailures: 1 }),
    ]);
    const found = byId(findings, 'finding-schema-org-partial');
    expect(found?.howWeKnowItFailed).toBe('https://example.com/about: a schema block is present but cannot be read');
    expect(found?.howWeKnowItFailed).not.toContain('no tags');
    expect(byId(findings, 'finding-schema-org-broken')).toBeUndefined();
  });

  it('case 5: the broken block does not change the health score', async () => {
    const withBroken = await audit([page({ schemasFound: [orgSchema], schemaParseFailures: 1 })]);
    const without = await audit([page({ schemasFound: [orgSchema] })]);
    expect(withBroken.healthScore).toBe(85);
    expect(withBroken.healthScore).toBe(without.healthScore);
    const brokenOnly = await audit([page({ schemaParseFailures: 1 })]);
    const none = await audit([page()]);
    expect(brokenOnly.healthScore).toBe(none.healthScore);
  });

  it('case 6: the finding survives the critic and shows in the report with its own label', async () => {
    const pages = [page({ schemasFound: [orgSchema], schemaParseFailures: 1 })];
    const { findings } = await audit(pages);
    const verified = criticReflectionEngine.verify(findings, [], pages, []).verifiedFindings;
    expect(byId(verified, 'finding-schema-org-broken')).toBeDefined();
    const board: BoardFinding[] = verified.map((item) => ({
      id: item.id,
      stableKey: item.id,
      domain: 'example.com',
      category: item.category,
      severity: item.severity,
      title: item.title,
      description: item.description,
      status: 'open',
      evidence: { howWeKnowItFailed: item.howWeKnowItFailed },
    })) as BoardFinding[];
    const html = renderToStaticMarkup(createElement(AuditReportArticle, {
      markdown: '# Example\n\n## 2. Plain verdict\n\nNo checklist sentence here.\n',
      measured: true,
      findings: board,
      domain: 'example.com',
      sources: [],
      showActions: false,
    }));
    expect(html).toContain('Fix the schema block that cannot be read');
  });
});
