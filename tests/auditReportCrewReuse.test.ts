import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BusinessDNA } from '../types';
import type { ScrapedPageEvidence, SerpEvidenceItem } from '../services/agentCore/types';

const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => storage[key] || null,
  setItem: (key: string, value: string) => { storage[key] = String(value); },
  removeItem: (key: string) => { delete storage[key]; },
  clear: () => { Object.keys(storage).forEach((key) => delete storage[key]); },
};
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  (globalThis as { window?: unknown }).window = globalThis;
}
(globalThis as { localStorage?: typeof mockLocalStorage }).localStorage = mockLocalStorage;

import { aiProviderService } from '../services/aiProviderService';
import { empiricalCitationService } from '../services/audit/empiricalCitationService';
import {
  formatCrewPagesForReport,
  formatCrewSerpForReport,
  serpRowsToCitationGroups,
} from '../services/audit/reuseCrewEvidence';
import { buildGuestScoutSummary } from '../services/audit/guestScoutSummary';
import { isUnmeasuredReportColumn } from '../services/audit/reportColumnGate';
import { citationIntegrityService } from '../services/audit/citationIntegrityService';
import { publicApisEnrichmentService } from '../services/enrichment/publicApisEnrichmentService';
import { writingQualityService } from '../services/audit/writingQualityService';
import { trafficInsightsService } from '../services/analytics/trafficInsightsService';
import { configService } from '../services/configService';
import { auditReportEvidenceFetch, geminiService } from '../services/geminiService';
import { siteEvidencePackService } from '../services/scraping/siteEvidencePack';
import { unifiedScraperService } from '../services/scraping/unifiedScraper';
import { localSerpService } from '../services/search/localSerpService';
import { tavilyService } from '../services/search/tavilyService';
import { vfsMemoryService } from '../services/vfs/vfsMemoryService';
import { generateAuditReportUnlessDegraded } from '../components/audit/InstantAuditView';

const dna: BusinessDNA = {
  name: 'Example',
  mission: 'Make widgets clear',
  usp: 'Plain widgets',
  targetAudience: 'Operators',
  competitors: ['Rival'],
  perceivedGaps: ['Thin comparisons'],
  rawContext: 'Example sells widgets.',
  industry: 'widgets',
};

function livePage(overrides: Partial<ScrapedPageEvidence> = {}): ScrapedPageEvidence {
  return {
    url: 'https://example.com',
    title: 'Example Home',
    description: 'Example describes widgets',
    h1s: ['Example widgets'],
    schemasFound: [{ type: 'Organization', rawJson: '{}', isValid: true }],
    wordCount: 120,
    rawTextSnippet: 'Example builds widgets for teams that need a clear homepage. '.repeat(6),
    source: 'firecrawl',
    ...overrides,
  };
}

function liveRow(overrides: Partial<SerpEvidenceItem> = {}): SerpEvidenceItem {
  return {
    query: '"Example" example.com',
    engine: 'tavily',
    title: 'Example official site',
    url: 'https://example.com',
    snippet: 'Example describes the product on the official site.',
    brandMentioned: true,
    ...overrides,
  };
}

const liveSerp: SerpEvidenceItem[] = [
  liveRow(),
  liveRow({
    query: 'best Example alternative reviews',
    title: 'Rival compared',
    url: 'https://rival.test/vs',
    snippet: 'Rival is a competing tool.',
    brandMentioned: false,
  }),
  liveRow({
    query: 'what is example.com',
    title: 'What is Example',
    url: 'https://news.example/what',
    snippet: 'Example is a widget company.',
    brandMentioned: true,
  }),
];

describe('crew evidence reuse helpers', () => {
  it('drops empty pages and sample search rows', () => {
    expect(formatCrewPagesForReport('https://example.com', [
      livePage({ wordCount: 0, rawTextSnippet: '   ', schemasFound: [], h1s: [] }),
    ])).toBeNull();
    expect(formatCrewSerpForReport([
      liveRow({ sample: true, title: 'SAMPLE result', snippet: 'why-sample fixture' }),
    ])).toBeNull();
    expect(serpRowsToCitationGroups([
      liveRow({ sample: true, title: 'SAMPLE result', snippet: 'why-sample fixture' }),
    ])).toEqual([]);
  });

  it('keeps observable pages and live rows', () => {
    const pages = formatCrewPagesForReport('https://example.com', [livePage({ source: 'jina' })]);
    expect(pages?.formattedEvidence).toContain('Mode: reused_crew');
    expect(pages?.formattedEvidence).toContain('via jina');
    expect(pages?.combinedText).toContain('Example builds widgets');
    const serp = formatCrewSerpForReport(liveSerp);
    expect(serp?.contextText).toContain('Example official site');
    expect(serp?.sources.map((source) => source.uri)).toContain('https://example.com');
    expect(serpRowsToCitationGroups(liveSerp)).toHaveLength(3);
  });
});

describe('prefetched citation scoring', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('stays not_measured when there are no rows and does not call Tavily', () => {
    const search = vi.spyOn(tavilyService, 'search');
    const summary = empiricalCitationService.summarizePrefetchedCitations('https://example.com', 'Example', ['Rival'], []);
    expect(summary.measurementStatus).toBe('not_measured');
    expect(summary.citationRatePercent).toBeNull();
    expect(summary.entityClarityScore).toBeNull();
    expect(summary.totalQueriesTested).toBe(0);
    expect(search).not.toHaveBeenCalled();
  });

  it('scores reused rows with the probe formula and does not invent a rate', () => {
    const search = vi.spyOn(tavilyService, 'search');
    const summary = empiricalCitationService.summarizePrefetchedCitations(
      'https://example.com',
      'Example',
      ['Rival'],
      serpRowsToCitationGroups(liveSerp),
    );
    expect(summary.measurementStatus).toBe('measured');
    expect(summary.totalQueriesTested).toBe(3);
    expect(summary.queriesCitedCount).toBe(2);
    expect(summary.citationRatePercent).toBe(67);
    expect(summary.topCitedCompetitor).toBe('Rival');
    expect(search).not.toHaveBeenCalled();
  });

  it('still runs the live Tavily probe when no prefetched rows are supplied', async () => {
    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('tvly-test');
    vi.spyOn(configService, 'isLocalSerpEnabled').mockReturnValue(false);
    const search = vi.spyOn(tavilyService, 'search').mockImplementation(async (query: string) => ({
      query,
      results: [{ title: 'Example', url: 'https://example.com', content: 'Example homepage', score: 0.9 }],
    }));
    const summary = await empiricalCitationService.probeDomainCitations('https://example.com', 'Example');
    expect(search).toHaveBeenCalledTimes(3);
    expect(summary.measurementStatus).toBe('measured');
    expect(summary.citationRatePercent).toBe(100);
  });
});

describe('generateAuditReport crew evidence', () => {
  let buildPack: ReturnType<typeof vi.spyOn>;
  let gather: ReturnType<typeof vi.spyOn>;
  let search: ReturnType<typeof vi.spyOn>;
  let probe: ReturnType<typeof vi.spyOn>;
  let scrape: ReturnType<typeof vi.spyOn>;
  let generate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockLocalStorage.clear();
    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('tvly-test');
    vi.spyOn(configService, 'isLocalSerpEnabled').mockReturnValue(false);
    vi.spyOn(localSerpService, 'search').mockResolvedValue({ success: false, results: [] } as never);
    buildPack = vi.spyOn(siteEvidencePackService, 'buildPack').mockResolvedValue({
      success: true,
      formattedEvidence: 'FALLBACK_PACK_MARKER',
      combinedText: 'fallback pack text '.repeat(20),
    } as never);
    scrape = vi.spyOn(unifiedScraperService, 'scrapeAndDistill').mockResolvedValue({ success: false } as never);
    gather = vi.spyOn(auditReportEvidenceFetch, 'gatherSearchEvidence');
    search = vi.spyOn(tavilyService, 'search').mockImplementation(async (query: string) => ({
      query,
      results: [{ title: 'Fetched result', url: 'https://fetched.example/r', content: 'fetched body', score: 0.8 }],
    }));
    probe = vi.spyOn(empiricalCitationService, 'probeDomainCitations');
    vi.spyOn(publicApisEnrichmentService, 'enrichAudit').mockResolvedValue(undefined as never);
    vi.spyOn(citationIntegrityService, 'evaluate').mockResolvedValue(undefined as never);
    vi.spyOn(trafficInsightsService, 'getImpact').mockResolvedValue({ status: 'not_configured', domain: 'example.com' } as never);
    vi.spyOn(writingQualityService, 'checkText').mockResolvedValue(undefined as never);
    vi.spyOn(aiProviderService, 'getBestAvailableProvider').mockResolvedValue({ id: 'groq' } as never);
    generate = vi.spyOn(aiProviderService, 'generateWithFailover').mockResolvedValue({ text: '# Luminara report' } as never);
  });

  async function run(crew?: { scrapedPages?: ScrapedPageEvidence[]; serpEvidence?: SerpEvidenceItem[] }) {
    return geminiService.generateAuditReport('https://example.com', 'AEO', dna, [], crew);
  }

  function prompt(): string {
    return String(generate.mock.calls[0]?.[0] || '');
  }

  it('skips pack, search rebuild, and extra Tavily calls when crew evidence is usable', async () => {
    const result = await run({ scrapedPages: [livePage()], serpEvidence: liveSerp });
    expect(buildPack).not.toHaveBeenCalled();
    expect(scrape).not.toHaveBeenCalled();
    expect(gather).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(prompt()).toContain('Example builds widgets');
    expect(prompt()).toContain('Example official site');
    expect(prompt()).not.toContain('FALLBACK_PACK_MARKER');
    expect(result.empiricalSummary?.measurementStatus).toBe('measured');
    expect(result.empiricalSummary?.citationRatePercent).toBe(67);
    expect(result.empiricalSummary?.topCitedCompetitor).toBe('Rival');
    expect(result.sources.some((source) => source.uri === 'https://rival.test/vs')).toBe(true);
  });

  it('keeps the existing fetch path when crew evidence is absent', async () => {
    const result = await run();
    expect(buildPack).toHaveBeenCalledTimes(1);
    expect(gather).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(search.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(prompt()).toContain('FALLBACK_PACK_MARKER');
    expect(result.empiricalSummary?.measurementStatus).toBe('measured');
    expect(result.empiricalSummary?.citationRatePercent).toBe(0);
  });

  it('falls back when pages are empty and search rows are samples', async () => {
    const result = await run({
      scrapedPages: [livePage({ wordCount: 0, rawTextSnippet: '  ', schemasFound: [], h1s: [], title: '' })],
      serpEvidence: [liveRow({ sample: true, title: 'SAMPLE result', snippet: 'why-sample fixture', url: 'https://sample.example' })],
    });
    expect(buildPack).toHaveBeenCalledTimes(1);
    expect(gather).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalled();
    expect(result.empiricalSummary?.citationRatePercent).not.toBe(45);
    expect(prompt()).toContain('FALLBACK_PACK_MARKER');
    expect(prompt()).not.toContain('why-sample');
  });

  it('reuses pages and still searches when SERP rows are missing', async () => {
    await run({ scrapedPages: [livePage()], serpEvidence: [] });
    expect(buildPack).not.toHaveBeenCalled();
    expect(scrape).not.toHaveBeenCalled();
    expect(gather).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalled();
    expect(prompt()).toContain('Example builds widgets');
    expect(prompt()).not.toContain('FALLBACK_PACK_MARKER');
  });

  it('reuses SERP rows and still builds a pack when pages are missing', async () => {
    const result = await run({ scrapedPages: [], serpEvidence: liveSerp });
    expect(buildPack).toHaveBeenCalledTimes(1);
    expect(gather).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();
    expect(probe).not.toHaveBeenCalled();
    expect(result.empiricalSummary?.measurementStatus).toBe('measured');
    expect(result.empiricalSummary?.citationRatePercent).toBe(67);
    expect(prompt()).toContain('FALLBACK_PACK_MARKER');
    expect(prompt()).toContain('Example official site');
  });

  it('does not turn a Jina page plus an empty live probe into a citation rate', async () => {
    search.mockImplementation(async (query: string) => ({ query, results: [] }));
    const result = await run({
      scrapedPages: [livePage({ source: 'jina' })],
      serpEvidence: [],
    });
    expect(buildPack).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(result.empiricalSummary?.measurementStatus).toBe('not_measured');
    expect(result.empiricalSummary?.citationRatePercent).toBeNull();
    expect(result.empiricalSummary?.entityClarityScore).toBeNull();
    expect(prompt()).toContain('via jina');
  });

  // SW0a-7: the report prompt asks for no column an evidence block cannot fill.
  it('asks the model for no rank, impact, rich result, AI Overview or trust signal column', async () => {
    await run({ scrapedPages: [livePage()], serpEvidence: liveSerp });
    const rules = prompt().slice(prompt().indexOf('Strict Formatting Guidelines:'));
    expect(rules).toContain('## AI & Search Visibility Radar');

    for (const label of ['Expected Impact', 'Est. Organic Rank', 'Rich Results', 'AI Overview Status', 'Trust Signal Strength']) {
      expect(rules.toLowerCase(), label).not.toContain(label.toLowerCase());
    }
    const requestedColumns = rules
      .split('\n')
      .filter((line) => line.trim().startsWith('|'))
      .flatMap((line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()));
    expect(requestedColumns).toEqual([
      'Task', 'Plain issue', 'Priority',
      'Query', 'Intent', 'Brand Cited (Yes/No)', 'Key Competitors', 'Citation Status (Cited/Not Cited/Not Measured)',
      'Entity', 'AI Perception (Tone/Claims)', 'Top Cited Page Types', 'Content Advantage (vs You)',
    ]);
    expect(requestedColumns.filter((column) => isUnmeasuredReportColumn(column))).toEqual([]);
  });

  it('does not invite the model to add figures labelled as estimates', async () => {
    await run({ scrapedPages: [livePage()], serpEvidence: liveSerp });
    const rules = prompt().slice(prompt().indexOf('Strict Formatting Guidelines:'));
    expect(rules).not.toContain('(estimate)');
    expect(rules).not.toMatch(/label every estimate/i);
    expect(rules).toContain('Do not add figures of your own.');
  });

  it('puts no cite-worthiness value or formula in the prompt and marks the trust block estimated', async () => {
    await run({ scrapedPages: [livePage()], serpEvidence: liveSerp });
    const text = prompt();
    const block = text.slice(text.indexOf('AEO TRUST PACK'));
    expect(text).toContain('[ESTIMATED: AEO TRUST PACK, PRELIMINARY]');
    expect(block).toContain('Cite-worthiness: not measured at this stage.');
    expect(text).not.toMatch(/cite-?worthiness\s*[:=]\s*\d/i);
    expect(text).not.toContain('Formula:');
    expect(text).not.toContain('0.30*securityTrust');
  });

  it('returns a report with no rank or impact column even when the model writes them', async () => {
    generate.mockResolvedValue({
      text: [
        '# Luminara: Will AI mention Example?',
        '',
        '## 3. Fix list',
        '| Task | Plain issue | Expected Impact | Priority |',
        '|------|-------------|-----------------|----------|',
        '| Add Organization schema | AI cannot tell who you are | +40% citations | High |',
        '',
        '## AI & Search Visibility Radar',
        '| Query | Intent | Brand Cited (Yes/No) | Key Competitors | Est. Organic Rank | Rich Results | AI Overview Status | Citation Status (Cited/Not Cited/Not Measured) |',
        '|---|---|---|---|---|---|---|---|',
        '| what is example.com | informational | Yes | none measured | Position 3 | FAQ snippet | Active | Cited |',
        '',
        '## Competitor Reality Map',
        '| Entity | AI Perception (Tone/Claims) | Top Cited Page Types | Content Advantage (vs You) | Trust Signal Strength (Low/Med/High) |',
        '|---|---|---|---|---|',
        '| Example | Clear | Homepage | None | Medium-High |',
      ].join('\n'),
    } as never);

    const remember = vi.spyOn(vfsMemoryService, 'ingestAuditAsResource');
    const result = await run({ scrapedPages: [livePage()], serpEvidence: liveSerp });

    // The copy kept in memory is gated too.
    expect(remember).toHaveBeenCalled();
    for (const call of remember.mock.calls) {
      for (const invented of ['Est. Organic Rank', 'Expected Impact', 'Trust Signal Strength', 'Position 3', 'Medium-High']) {
        expect(String(call[0])).not.toContain(invented);
      }
    }

    const lines = result.text.split('\n');
    const headerCells = lines
      .filter((line, index) => line.trim().startsWith('|') && (lines[index + 1] || '').includes('---'))
      .flatMap((line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()));
    expect(headerCells).toHaveLength(12);
    expect(headerCells.filter((cell) => /rank|impact|rich result|ai overview|trust signal/i.test(cell))).toEqual([]);
    for (const invented of ['+40% citations', 'Position 3', 'FAQ snippet', 'Active', 'Medium-High']) {
      expect(result.text).not.toContain(invented);
    }
    expect(result.text).toContain('Add Organization schema');
    expect(result.text).toContain('what is example.com');
  });

  it('passes crew pages and SERP rows from Instant Audit into the report', async () => {
    const report = vi.spyOn(geminiService, 'generateAuditReport').mockResolvedValue({ text: 'ok', sources: [] } as never);
    const pages = [livePage()];
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com',
      measurementStatus: 'measured',
      citationRatePercent: 67,
      shareOfVoiceScore: 40,
      healthScore: 70,
      scrapedPageCount: 1,
      serpCount: liveSerp.length,
      findings: [],
      hostedRail: 'signed_in_hosted',
    });
    await generateAuditReportUnlessDegraded({
      isGuest: false,
      summary,
      measurementStatus: 'measured',
      formattedUrl: 'https://example.com',
      targetFocus: 'AEO',
      dna,
      lenses: [],
      scrapedPages: pages,
      serpEvidence: liveSerp,
    });
    expect(report).toHaveBeenCalledWith('https://example.com', 'AEO', dna, [], {
      scrapedPages: pages,
      serpEvidence: liveSerp,
    });
  });
});
