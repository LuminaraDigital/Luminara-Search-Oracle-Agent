import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentMissionControl, missionControlCardBadge, missionControlHeadline, missionControlProgressLabel } from '../../components/audit/AgentMissionControl';
import { GuestScoutSummaryPanel } from '../../components/audit/GuestScoutSummaryPanel';
import { generateAuditReportUnlessDegraded, instantAuditPrimaryLabel } from '../../components/audit/InstantAuditView';
import { ReportDisplay } from '../../components/audit/ReportDisplay';
import { pricingTiers } from '../../components/PricingPage';
import { competitorStrategistAgent } from '../../services/agentCore/agents/competitorStrategistAgent';
import { executiveTranslatorAgent } from '../../services/agentCore/agents/executiveTranslatorAgent';
import { playbookAuditorAgent } from '../../services/agentCore/agents/playbookAuditorAgent';
import { remediationArchitectAgent } from '../../services/agentCore/agents/remediationArchitectAgent';
import { scoutAgent } from '../../services/agentCore/agents/scoutAgent';
import { serpRadarAgent } from '../../services/agentCore/agents/serpRadarAgent';
import {
  CREW_PROFILES,
  applyMemorySync,
  createInitialAuditContext,
  crewOrchestrator,
  criticStartMessage,
  deriveAuditMeasurement,
  memorySyncPlan,
} from '../../services/agentCore/crewOrchestrator';
import type { AgentActivityEvent, AgentRole, ScrapedPageEvidence, SerpEvidenceItem } from '../../services/agentCore/types';
import { HEALTH_CHECKS, healthChecklist } from '../../services/agentCore/auditEvidenceGate';
import { empiricalCitationService } from '../../services/audit/empiricalCitationService';
import { buildGuestScoutSummary } from '../../services/audit/guestScoutSummary';
import { geminiService } from '../../services/geminiService';
import { configService } from '../../services/configService';
import { mem0MemoryEngine } from '../../services/agentCore/mem0MemoryEngine';
import { hostedAuthBlocked, noteHostedAuthFailure, resetHostedAuthCircuit } from '../../services/resilience/hostedAuthCircuit';
import { firecrawlService } from '../../services/scraping/firecrawlService';
import { patchrightClient } from '../../services/scraping/patchrightClient';
import { siteEvidencePackService } from '../../services/scraping/siteEvidencePack';
import { unifiedScraperService } from '../../services/scraping/unifiedScraper';
import { localSerpService } from '../../services/search/localSerpService';
import { tavilyService } from '../../services/search/tavilyService';

const noop = () => {};

function livePage(partial: Partial<ScrapedPageEvidence> = {}): ScrapedPageEvidence {
  return {
    url: 'https://example.com',
    title: 'Example',
    h1s: ['Example'],
    schemasFound: [{ type: 'Organization', rawJson: '{}', isValid: true }],
    wordCount: 400,
    rawTextSnippet: 'Example publishes enough product detail for a real page audit.',
    source: 'patchright',
    ...partial,
  };
}

function liveSerp(brandMentioned = true): SerpEvidenceItem {
  return {
    query: 'example official',
    engine: 'tavily',
    title: 'Example official site',
    url: 'https://example.com/about',
    snippet: 'Example publishes product detail.',
    brandMentioned,
  };
}

function installHostedWeb(storage: Record<string, string> = {}): void {
  const store: Record<string, string> = { ...storage };
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { for (const key of Object.keys(store)) delete store[key]; },
  });
  vi.stubGlobal('window', {
    location: {
      hostname: 'luminarasuite.com',
      host: 'luminarasuite.com',
      origin: 'https://luminarasuite.com',
      protocol: 'https:',
      href: 'https://luminarasuite.com/',
      search: '',
    },
    dispatchEvent: () => true,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetHostedAuthCircuit();
});

describe('Instant Audit honesty on empty evidence', () => {
  it('starts the crew with null metrics, not seeded scores', () => {
    const ctx = createInitialAuditContext('example.com');
    expect(ctx.citationRatePercent).toBeNull();
    expect(ctx.shareOfVoiceScore).toBeNull();
    expect(ctx.healthScore).toBeNull();
    expect(ctx.measurementStatus).toBe('not_measured');
    expect(deriveAuditMeasurement(ctx).measurementStatus).toBe('not_measured');
    expect(deriveAuditMeasurement({
      citationRatePercent: 40,
      shareOfVoiceScore: 30,
      healthScore: 80,
    }).measurementStatus).toBe('measured');
  });

  it('does not invent citation rate or share of voice when SERP evidence is empty', async () => {
    installHostedWeb();
    expect(configService.isLocalSerpEnabled()).toBe(false);
    expect(configService.getPatchrightUrl()).toBe('');
    expect(configService.getLocalSerpUrl()).toBe('');
    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('');
    const localSearch = vi.spyOn(localSerpService, 'search');
    const events: { message: string }[] = [];
    const result = await serpRadarAgent.execute('example.com', null, (event) => {
      events.push(event);
    });
    expect(result.serpEvidence).toEqual([]);
    expect(result.citationRatePercent).toBeNull();
    expect(result.shareOfVoiceScore).toBeNull();
    const done = events.map((event) => event.message).join(' ');
    expect(done).toContain('not measured');
    expect(done).not.toContain('45%');
    expect(done).not.toMatch(/Share-of-Voice: \d+/);
    expect(localSearch).not.toHaveBeenCalled();
  });

  it('does not invent metrics when a configured search provider returns no rows', async () => {
    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('test-key');
    vi.spyOn(tavilyService, 'search').mockResolvedValue({ query: 'q', results: [] });
    const result = await serpRadarAgent.execute('example.com', null, noop);
    expect(result.citationRatePercent).toBeNull();
    expect(result.shareOfVoiceScore).toBeNull();
  });

  it('calculates citation rate only from returned SERP rows', async () => {
    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('test-key');
    vi.spyOn(tavilyService, 'search').mockImplementation(async (query: string) => ({
      query,
      results: [
        {
          title: 'Example official site',
          url: 'https://example.com/about',
          content: 'Example describes the product.',
          score: 0.9,
        },
      ],
    }));
    const result = await serpRadarAgent.execute('example.com', null, noop);
    expect(result.serpEvidence.length).toBeGreaterThan(0);
    expect(result.citationRatePercent).toBe(100);
    expect(result.shareOfVoiceScore).not.toBeNull();
    expect(result.citationRatePercent).not.toBe(45);
  });

  // SW0a-7: share of voice is a count of evidence rows, not a formula.
  it('carries no share of voice number that is not a count of evidence rows', async () => {
    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('test-key');
    // Rows per query, and how many of them mention the brand. Three queries run per audit.
    const cases = [
      { perQuery: 3, mentionedPerQuery: 1 }, // 3 of 9
      { perQuery: 3, mentionedPerQuery: 3 }, // 9 of 9
      { perQuery: 1, mentionedPerQuery: 1 }, // 3 of 3
      { perQuery: 2, mentionedPerQuery: 0 }, // 0 of 6
    ];
    for (const { perQuery, mentionedPerQuery } of cases) {
      vi.spyOn(tavilyService, 'search').mockImplementation(async (query: string) => ({
        query,
        results: Array.from({ length: perQuery }, (_, index) => (
          index < mentionedPerQuery
            ? { title: 'Example official site', url: `https://example.com/p${index}`, content: 'Example describes the product.', score: 0.9 }
            : { title: 'Another brand review', url: `https://other.test/p${index}`, content: 'A different product.', score: 0.5 }
        )),
      }));
      const events: { message: string }[] = [];
      const result = await serpRadarAgent.execute('example.com', null, (event) => {
        events.push(event);
      });

      const rows = result.serpEvidence.length;
      const mentionedRows = result.serpEvidence.filter((row) => row.brandMentioned).length;
      expect(rows).toBe(perQuery * 3);
      expect(mentionedRows).toBe(mentionedPerQuery * 3);

      const shareOfVoiceFields = Object.entries(result).filter(([key]) => /share.?of.?voice/i.test(key));
      expect(shareOfVoiceFields.length).toBeGreaterThan(0);
      for (const [, value] of shareOfVoiceFields) {
        expect(value).toBe(mentionedRows);
      }

      const text = events.map((event) => event.message).join(' ');
      expect(text).toContain(`Brand mentioned in ${mentionedRows} of ${rows}.`);
      // The same two counts are not printed again as a percentage.
      expect(text).not.toMatch(/\d\s*%/);
      expect(text).not.toMatch(/citation rate/i);
      expect(text).not.toMatch(/Share-of-Voice/i);
      expect(text).not.toMatch(/\/100/);
    }
  });

  // SW0a-7 review, item 4: the radar names the one source it queries.
  it('says which search source the radar is checking, and names no engine it does not query', async () => {
    const startLine = async () => {
      const events: AgentActivityEvent[] = [];
      await serpRadarAgent.execute('example.com', null, (event) => {
        events.push(event);
      });
      return events.find((event) => event.phase === 'probing_engines')?.message || '';
    };
    vi.spyOn(tavilyService, 'search').mockImplementation(async (query: string) => ({ query, results: [] }));
    vi.spyOn(localSerpService, 'search').mockResolvedValue(null as never);

    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('test-key');
    const withTavily = await startLine();
    expect(withTavily).toContain('through Tavily web search');

    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('');
    vi.spyOn(configService, 'isLocalSerpEnabled').mockReturnValue(true);
    const withSidecar = await startLine();
    expect(withSidecar).toContain('through the local search sidecar');

    vi.spyOn(configService, 'isLocalSerpEnabled').mockReturnValue(false);
    const withNothing = await startLine();
    expect(withNothing).toContain('Checking web search results for "example"');
    expect(withNothing).not.toContain('through');

    for (const line of [withTavily, withSidecar, withNothing]) {
      expect(line).not.toMatch(/Google|Perplexity|AI Overviews?|ChatGPT|Probing/);
    }
  });

  it('shows share of voice on the scout card as the count it was built from', () => {
    const base = {
      targetUrl: 'https://example.com',
      measurementStatus: 'measured' as const,
      citationRatePercent: 33,
      healthScore: 80,
      scrapedPageCount: 1,
      serpCount: 9,
      findings: [],
      hostedRail: 'signed_in_hosted' as const,
    };
    const badge = (shareOfVoiceScore: number | null, serpCount = 9) => buildGuestScoutSummary({ ...base, serpCount, shareOfVoiceScore })
      .badges.find((item) => item.label === 'Share of voice');

    expect(badge(3)).toEqual({ label: 'Share of voice', status: 'measured', value: 'mentioned in 3 of 9 web results' });
    expect(badge(0)).toEqual({ label: 'Share of voice', status: 'measured', value: 'mentioned in 0 of 9 web results' });
    expect(badge(null)).toEqual({ label: 'Share of voice', status: 'not_measured' });
    // A stored 0-100 formula score is not a count of nine rows. It is not shown.
    expect(badge(43)).toEqual({ label: 'Share of voice', status: 'not_measured' });
    expect(badge(2.5)).toEqual({ label: 'Share of voice', status: 'not_measured' });

    const html = renderToStaticMarkup(createElement(GuestScoutSummaryPanel, {
      summary: buildGuestScoutSummary({ ...base, shareOfVoiceScore: 3 }),
    }));
    expect(html).toContain('Share of voice: mentioned in 3 of 9 web results');
    expect(html).not.toMatch(/Share of voice:\s*\d+\s*\/\s*100/);
  });

  it('leaves health unmeasured when scrape and SERP evidence are both empty', async () => {
    const events: { message: string }[] = [];
    const result = await playbookAuditorAgent.execute('AEO', [], [], null, (event) => {
      events.push(event);
    });
    expect(result.healthScore).toBeNull();
    expect(result.findings).toEqual([]);
    expect(events.map((event) => event.message).join(' ')).toContain('not measured');
    expect(events.map((event) => event.message).join(' ')).not.toContain('/100');
  });

  it('does not invent health or schema findings when the scrape is empty but SERP has rows', async () => {
    const events: { message: string }[] = [];
    const result = await playbookAuditorAgent.execute(
      'AEO',
      [],
      [{
        query: 'example alternative',
        engine: 'tavily',
        title: 'Other brand review',
        url: 'https://other.example/review',
        snippet: 'A different product.',
        brandMentioned: false,
      }],
      null,
      (event) => {
        events.push(event);
      },
    );
    expect(result.healthScore).toBeNull();
    expect(result.findings.some((finding) => finding.category === 'schema')).toBe(false);
    expect(result.findings.some((finding) => finding.title.includes('Missing Organization'))).toBe(false);
    const measurement = deriveAuditMeasurement({
      citationRatePercent: 0,
      shareOfVoiceScore: 5,
      healthScore: result.healthScore,
    });
    expect(measurement.measurementStatus).toBe('not_measured');
    expect(missionControlHeadline(true, measurement.measurementStatus)).not.toContain('live page');
    const text = events.map((event) => event.message).join(' ');
    expect(text).toContain('not measured');
    expect(text).not.toMatch(/\/100/);
  });

  it('does not invent a 73 health score when search evidence is empty', async () => {
    const events: { message: string }[] = [];
    const result = await playbookAuditorAgent.execute(
      'AEO',
      [livePage({ schemasFound: [] })],
      [],
      null,
      (event) => {
        events.push(event);
      },
    );
    expect(result.healthScore).toBeNull();
    const text = events.map((event) => event.message).join(' ');
    expect(text).toContain('not measured');
    expect(text).not.toMatch(/\/100/);
    expect(text).not.toContain('73');
    expect(missionControlCardBadge('completed', text)).toBe('not_measured');
    const withSchema = await playbookAuditorAgent.execute('AEO', [livePage()], [], null, noop);
    expect(withSchema.healthScore).toBeNull();
  });

  it('does not invent a 73 health score from Jina-only page text', async () => {
    const events: AgentActivityEvent[] = [];
    const result = await playbookAuditorAgent.execute(
      'AEO',
      [livePage({
        url: 'https://seamossvibes.com.au',
        title: 'Sea Moss Vibes',
        schemasFound: [],
        wordCount: 420,
        source: 'jina',
        rawTextSnippet: 'Sea moss product copy returned by a reader fallback with no JSON-LD.',
      })],
      [],
      null,
      (event) => {
        events.push(event);
      },
    );
    expect(result.healthScore).toBeNull();
    expect(result.findings.some((finding) => finding.title.includes('Missing Organization'))).toBe(false);
    const text = events.map((event) => event.message).join(' ');
    expect(text).toContain('Jina-only');
    expect(text).toContain('not measured');
    expect(text).not.toMatch(/\/100/);
    expect(text).not.toContain('73');
    const html = renderToStaticMarkup(createElement(AgentMissionControl, {
      events,
      isComplete: true,
      measurementStatus: 'not_measured',
    }));
    expect(html).toContain('Not measured');
    expect(html).toContain('Jina-only');
    expect(html).not.toMatch(/\/100/);
    expect(html).not.toContain('73');
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://seamossvibes.com.au',
      measurementStatus: 'not_measured',
      citationRatePercent: null,
      shareOfVoiceScore: null,
      healthScore: result.healthScore,
      scrapedPageCount: 1,
      serpCount: 0,
      findings: result.findings.map((finding) => ({ title: finding.title })),
      hostedRail: 'byok_or_signin',
    });
    expect(summary.badges.find((badge) => badge.label === 'Page health')).toEqual({
      label: 'Page health',
      status: 'not_measured',
    });
    expect(JSON.stringify(summary)).not.toContain('73');

    const withLiveSearch = await playbookAuditorAgent.execute(
      'AEO',
      [livePage({
        url: 'https://seamossvibes.com.au',
        schemasFound: [],
        wordCount: 420,
        source: 'jina',
        rawTextSnippet: 'Sea moss product copy returned by a reader fallback with no JSON-LD.',
      })],
      [liveSerp()],
      null,
      noop,
    );
    expect(withLiveSearch.healthScore).toBeNull();
    expect(withLiveSearch.findings.some((finding) => finding.title.includes('Missing Organization'))).toBe(false);
  });

  it('does not invent health, citation, or share of voice from SAMPLE search rows', async () => {
    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('test-key');
    vi.spyOn(tavilyService, 'search').mockImplementation(async (query: string) => ({
      query,
      results: [{
        title: 'SAMPLE competitor',
        url: 'https://other.example/why-SAMPLE',
        content: 'why-SAMPLE fixture, not a live result',
        score: 0.4,
      }],
    }));
    const serpEvents: { message: string }[] = [];
    const serp = await serpRadarAgent.execute('example.com', null, (event) => {
      serpEvents.push(event);
    });
    expect(serp.serpEvidence).toEqual([]);
    expect(serp.citationRatePercent).toBeNull();
    expect(serp.shareOfVoiceScore).toBeNull();
    const serpText = serpEvents.map((event) => event.message).join(' ');
    expect(serpText).toContain('not measured');
    expect(serpText).not.toMatch(/Share-of-Voice: \d+/);
    expect(serpText).not.toMatch(/\d+%/);

    const events: { message: string }[] = [];
    const result = await playbookAuditorAgent.execute(
      'AEO',
      [livePage({ schemasFound: [] })],
      [{
        ...liveSerp(false),
        sample: true,
        title: 'SAMPLE result',
        url: 'https://other.example/why-SAMPLE',
        snippet: 'why-SAMPLE fixture',
      }],
      null,
      (event) => {
        events.push(event);
      },
    );
    expect(result.healthScore).toBeNull();
    const text = events.map((event) => event.message).join(' ');
    expect(text).toContain('not measured');
    expect(text).not.toMatch(/\/100/);
    expect(text).not.toContain('73');
  });

  it('scores health when a live scrape and live search are both present', async () => {
    const result = await playbookAuditorAgent.execute('AEO', [livePage()], [liveSerp()], null, noop);
    expect(result.healthScore).toBe(85);
  });

  it('still applies a real schema penalty when live scrape and live search are both present', async () => {
    const events: { message: string }[] = [];
    const result = await playbookAuditorAgent.execute(
      'AEO',
      [livePage({ schemasFound: [] })],
      [liveSerp()],
      null,
      (event) => {
        events.push(event);
      },
    );
    expect(result.healthScore).toBe(73);
    expect(result.findings.some((finding) => finding.title.includes('Missing Organization'))).toBe(true);
    // The progress line gives the count of checks, not the checklist number.
    const said = events.map((event) => event.message).join(' ');
    expect(said).toContain('3 of 4 checks passed, 1 failed.');
    expect(said).not.toMatch(/\d+\s*\/\s*100/);
    expect(said).not.toMatch(/health score/i);
  });

  it('counts the checks behind the health number, one per finding the checklist knows', () => {
    expect(HEALTH_CHECKS.map((check) => check.findingId)).toEqual([
      'finding-zero-citations', 'finding-schema-org', 'finding-deprecated-howto', 'finding-thin-content',
    ]);
    expect(healthChecklist([])).toEqual({ total: 4, failed: 0, passed: 4 });
    expect(healthChecklist([{ id: 'finding-schema-org' }, { id: 'finding-thin-content' }, { id: 'something-else' }]))
      .toEqual({ total: 4, failed: 2, passed: 2 });
  });

  it('says nothing about AI overviews in the zero mention finding, only what the search rows show', async () => {
    const result = await playbookAuditorAgent.execute('AEO', [livePage()], [liveSerp(false), liveSerp(false)], null, noop);
    const finding = result.findings.find((item) => item.id === 'finding-zero-citations');
    expect(finding?.description).toBe('None of the 2 web search results this run collected mention the brand.');
  });

  it('keeps a connection-refused Jina fallback from inventing a health score', async () => {
    vi.spyOn(siteEvidencePackService, 'buildPack').mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:3001'));
    vi.spyOn(unifiedScraperService, 'scrapeAndDistill').mockResolvedValue({
      success: true,
      providerUsed: 'jina',
      url: 'https://seamossvibes.com.au',
      statusCode: 200,
      title: 'Sea Moss Vibes',
      description: '',
      markdown: 'Sea moss gel for daily drinks. '.repeat(40),
      distilled: {
        title: 'Sea Moss Vibes',
        description: '',
        openGraph: {},
        schemas: [],
        schemaTypes: [],
        headings: [],
        distilledText: 'Sea moss gel for daily drinks.',
        formattedEvidence: '',
        stats: { rawChars: 200, distilledChars: 40, compressionRatio: 0.2 },
      },
      formattedEvidence: '',
      latencyMs: 30,
    });
    const pages = await scoutAgent.execute('https://seamossvibes.com.au', noop);
    expect(pages).toHaveLength(1);
    expect(pages[0]?.source).toBe('jina');
    expect(hostedAuthBlocked()).toBe(false);
    const events: { message: string }[] = [];
    const result = await playbookAuditorAgent.execute('AEO', pages, [], null, (event) => {
      events.push(event);
    });
    expect(result.healthScore).toBeNull();
    expect(events.map((event) => event.message).join(' ')).not.toMatch(/\/100/);
    expect(events.map((event) => event.message).join(' ')).not.toContain('73');
  });

  it('does not pretend a failed scrape discovered a page', async () => {
    vi.spyOn(siteEvidencePackService, 'buildPack').mockRejectedValue(new Error('Firecrawl 401'));
    vi.spyOn(unifiedScraperService, 'scrapeAndDistill').mockRejectedValue(new Error('Firecrawl 401'));
    const events: { message: string }[] = [];
    const pages = await scoutAgent.execute('https://example.com', (event) => {
      events.push(event);
    });
    expect(pages).toEqual([]);
    const text = events.map((event) => event.message).join(' ');
    expect(text).toContain('On-page evidence not measured');
    expect(text).not.toContain('Scouted 1');
  });

  it('keeps numeric scores out of the executive brief when they were not measured', async () => {
    const brief = await executiveTranslatorAgent.execute(
      'https://example.com',
      null,
      null,
      [],
      [],
      null,
      noop,
    );
    expect(brief.toLowerCase()).toContain('not measured');
    expect(brief).not.toMatch(/\d+%/);
    expect(brief).not.toMatch(/\/100/);

    const measured = await executiveTranslatorAgent.execute(
      'https://example.com',
      { passed: 3, total: 4 },
      { mentioned: 2, total: 9 },
      [],
      [],
      null,
      noop,
    );
    expect(measured).toContain('passed 3 of 4 checks');
    expect(measured).toContain('mentioned in 2 of 9 web results');
    expect(measured).not.toMatch(/\d+\s*\/\s*100/);
    expect(measured).not.toMatch(/health score/i);
  });

  // SW0a-7: the brief quotes the two counts and makes no claim about AI answers.
  it('says "mentioned in N of M web results" in the executive brief, never a share of AI answers', async () => {
    const both = await executiveTranslatorAgent.execute('https://example.com', { passed: 4, total: 4 }, { mentioned: 2, total: 9 }, [], [], null, noop);
    const mentionsOnly = await executiveTranslatorAgent.execute('https://example.com', null, { mentioned: 0, total: 6 }, [], [], null, noop);
    expect(both).toContain('mentioned in 2 of 9 web results');
    expect(mentionsOnly).toContain('mentioned in 0 of 6 web results');
    expect(mentionsOnly).toContain('The site checks were not measured.');
    for (const brief of [both, mentionsOnly]) {
      expect(brief).not.toMatch(/\d+(?:\.\d+)?\s*%/);
      expect(brief).not.toMatch(/AI search answers/i);
      expect(brief).not.toMatch(/cited in about/i);
      expect(brief).not.toMatch(/double/i);
    }
  });

  it('makes no promise to double citations when a site has no critical findings', async () => {
    const healthOnly = await executiveTranslatorAgent.execute('https://example.com', { passed: 4, total: 4 }, null, [], [], null, noop);
    expect(healthOnly).toContain('The Big Takeaway');
    expect(healthOnly).not.toMatch(/double/i);
    expect(healthOnly).not.toMatch(/comparison pages/i);
    expect(healthOnly).toContain('Citation rate was not measured.');
  });

  const failedCheck = (id: string, severity: 'critical' | 'high' | 'medium' = 'high') => ({
    id,
    category: 'schema' as const,
    severity,
    title: `Finding ${id}`,
    description: 'd',
    evidenceSource: 'e',
    howWeKnowItFailed: 'h',
    leadingIndicator: 'l',
    criticVerified: true,
    criticConfidence: 0.9,
  });

  it('says what the steps are in the bottom line, not what they will cause', async () => {
    const brief = await executiveTranslatorAgent.execute(
      'https://example.com', { passed: 3, total: 4 }, { mentioned: 2, total: 9 }, [failedCheck('finding-schema-org')], [], null, noop,
    );
    const bottomLine = brief.split('\n').find((line) => line.includes('Bottom Line'));
    expect(bottomLine).toBe('*Bottom Line:* These are the steps the failed checks point to. This run did not measure what they will change.');
    expect(brief).not.toMatch(/significantly|easier|will make|instead of your competitors/i);
  });

  // Review 2, 6: the brief used to list the same three actions whatever the checks found.
  it('lists a step only for a check that failed', async () => {
    const steps = (brief: string) => brief.split('\n').filter((line) => /^\d+\. /.test(line));

    const one = await executiveTranslatorAgent.execute(
      'https://example.com', { passed: 3, total: 4 }, null, [failedCheck('finding-thin-content')], [], null, noop,
    );
    expect(one).toContain('#### 1 step for the check that failed:');
    expect(steps(one)).toHaveLength(1);
    expect(steps(one)[0]).toContain('**Write fuller answers on thin pages:**');
    expect(one).not.toContain('Organization tag');
    expect(one).not.toContain('llms.txt');

    const all = await executiveTranslatorAgent.execute(
      'https://example.com',
      { passed: 0, total: 4 },
      null,
      // Given out of order, and with a finding that is not one of the four checks.
      [failedCheck('finding-thin-content'), failedCheck('something-else'), failedCheck('finding-deprecated-howto', 'medium'), failedCheck('finding-schema-org'), failedCheck('finding-zero-citations')],
      [],
      null,
      noop,
    );
    expect(all).toContain('#### 4 steps for the checks that failed:');
    expect(steps(all).map((line) => line.slice(0, line.indexOf(':**')))).toEqual([
      '1. **Say plainly what you offer',
      '2. **Add an Organization tag',
      '3. **Remove the HowTo markup',
      '4. **Write fuller answers on thin pages',
    ]);
  });

  it('says so and lists no step when every check passed, or when the checks did not run', async () => {
    const allPassed = await executiveTranslatorAgent.execute('https://example.com', { passed: 4, total: 4 }, { mentioned: 2, total: 9 }, [], [], null, noop);
    expect(allPassed).toContain('passed 4 of 4 checks');
    expect(allPassed).toContain('All 4 checks this run made passed, so there are no steps to list.');
    const notRun = await executiveTranslatorAgent.execute('https://example.com', null, null, [], [], null, noop);
    expect(notRun).toContain('The site checks were not measured, so there are no steps to list.');
    for (const brief of [allPassed, notRun]) {
      expect(brief.split('\n').filter((line) => /^\d+\. /.test(line))).toEqual([]);
      expect(brief).not.toContain('Organization tag');
      expect(brief).not.toContain('Bottom Line');
      expect(brief).not.toMatch(/Actions You Can Take/);
    }
  });

  it('names no platform the run did not query and prints no score out of 100 in the brief', async () => {
    const critical = {
      id: 'finding-schema-org',
      category: 'schema' as const,
      severity: 'critical' as const,
      title: 'Missing Organization / Brand Entity Schema',
      description: 'd',
      evidenceSource: 'e',
      howWeKnowItFailed: 'h',
      leadingIndicator: 'l',
      criticVerified: true,
      criticConfidence: 0.9,
    };
    const briefs = [
      await executiveTranslatorAgent.execute('https://example.com', { passed: 3, total: 4 }, { mentioned: 2, total: 9 }, [critical], [], null, noop),
      await executiveTranslatorAgent.execute('https://example.com', { passed: 4, total: 4 }, { mentioned: 2, total: 9 }, [], [], null, noop),
      await executiveTranslatorAgent.execute('https://example.com', null, null, [], [], null, noop),
    ];
    for (const brief of briefs) {
      expect(brief).not.toMatch(/ChatGPT|Perplexity|Gemini|Google|AI Overviews?/);
      expect(brief).not.toMatch(/\d+\s*\/\s*100/);
      expect(brief).not.toMatch(/health score/i);
    }
    expect(briefs[0]).toContain('This run found 1 critical gap: Missing Organization / Brand Entity Schema.');
    expect(briefs[1]).toContain('None of the checks this run made found a critical gap.');
  });

  it('treats check counts that cannot be a count as not measured in the brief', async () => {
    for (const bad of [{ passed: 5, total: 4 }, { passed: 2.5, total: 4 }, { passed: 0, total: 0 }, { passed: -1, total: 4 }]) {
      const brief = await executiveTranslatorAgent.execute('https://example.com', bad, null, [], [], null, noop);
      expect(brief).not.toContain('checks**');
      expect(brief).toContain('the site checks and citation rate were not measured');
    }
  });

  it('builds the crew brief from the rows the radar returned, not from a percentage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    const rows = [liveSerp(true), liveSerp(false), liveSerp(true), liveSerp(false), liveSerp(false)];
    vi.spyOn(scoutAgent, 'execute').mockResolvedValue([livePage()]);
    vi.spyOn(serpRadarAgent, 'execute').mockResolvedValue({ serpEvidence: rows, citationRatePercent: 40, shareOfVoiceScore: 2 });
    vi.spyOn(playbookAuditorAgent, 'execute').mockResolvedValue({ findings: [], healthScore: 81 });
    vi.spyOn(competitorStrategistAgent, 'execute').mockResolvedValue({ topCompetitors: [], competitorGaps: [] });
    vi.spyOn(remediationArchitectAgent, 'execute').mockResolvedValue([]);
    const translate = vi.spyOn(executiveTranslatorAgent, 'execute');

    const result = await crewOrchestrator.runAuditCrew('https://example.com', 'AEO', null, noop);

    expect(translate.mock.calls[0]?.[1]).toEqual({ total: 4, failed: 0, passed: 4 });
    expect(translate.mock.calls[0]?.[2]).toEqual({ mentioned: 2, total: 5 });
    expect(result.plainEnglishBrief).toContain('passed 4 of 4 checks');
    expect(result.plainEnglishBrief).toContain('mentioned in 2 of 5 web results');
    expect(result.plainEnglishBrief).not.toContain('81');
    expect(result.plainEnglishBrief).not.toMatch(/\d+(?:\.\d+)?\s*%/);
    expect(result.plainEnglishBrief).not.toMatch(/AI search answers/i);
    mem0MemoryEngine.clear();
  });

  it('treats counts that cannot be a count of rows as not measured in the executive brief', async () => {
    for (const bad of [{ mentioned: 5, total: 0 }, { mentioned: 7, total: 3 }, { mentioned: 1.5, total: 4 }, { mentioned: -1, total: 4 }]) {
      const brief = await executiveTranslatorAgent.execute('https://example.com', null, bad, [], [], null, noop);
      expect(brief).not.toContain('web results');
      expect(brief.toLowerCase()).toContain('not measured');
    }
  });

  it('returns not_measured citation summary when every search probe is empty', async () => {
    installHostedWeb({ luminara_local_serp_enabled: 'true' });
    expect(configService.isLocalSerpEnabled()).toBe(false);
    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('');
    const localSearch = vi.spyOn(localSerpService, 'search');
    const summary = await empiricalCitationService.probeDomainCitations('https://example.com', 'Example');
    expect(summary.measurementStatus).toBe('not_measured');
    expect(summary.citationRatePercent).toBeNull();
    expect(summary.entityClarityScore).toBeNull();
    expect(summary.evidenceList).toEqual([]);
    expect(localSearch).not.toHaveBeenCalled();
  });
});

describe('Mission Control copy', () => {
  it('does not claim ground-truth verification when metrics were not measured', () => {
    expect(missionControlHeadline(true, 'not_measured')).toBe(
      'Audit finished. Some signals were not measured.',
    );
    expect(missionControlHeadline(true, 'not_measured')).not.toContain('ground-truth');
    expect(missionControlHeadline(true, 'measured')).not.toContain('ground-truth');
    expect(missionControlHeadline(false, 'not_measured')).toContain('collaborating');

    const events = (Object.keys(CREW_PROFILES) as AgentRole[]).map((role) => ({
      id: role,
      timestamp: 1,
      agentRole: role,
      agentName: CREW_PROFILES[role].name,
      phase: 'done',
      message:
        role === 'serp_radar'
          ? 'Analyzed 0 SERP results. Citation rate and share of voice were not measured.'
          : 'Finished without a numeric score.',
      status: 'completed' as const,
    }));
    const html = renderToStaticMarkup(
      createElement(AgentMissionControl, {
        events,
        isComplete: true,
        measurementStatus: 'not_measured',
      }),
    );
    expect(html).toContain('AGENT PROGRESS');
    expect(html).toContain('NOT MEASURED');
    expect(html).not.toContain('100% COMPLETE');
    expect(missionControlProgressLabel(true, 'measured', 100)).toBe('100% COMPLETE');
    expect(html).toContain('Audit finished. Some signals were not measured.');
    expect(html).toContain('agent progress, not evidence quality');
    expect(html).not.toContain('ground-truth');
    expect(html).not.toContain('45%');
  });

  it('badges completed unmeasured scout and auditor cards as Not measured', () => {
    expect(missionControlCardBadge('completed', 'Page fetch failed. On-page evidence not measured.')).toBe('not_measured');
    expect(missionControlCardBadge('completed', 'Compliance audit finished. Health score not measured: no page evidence.')).toBe('not_measured');
    expect(missionControlCardBadge('completed', 'Scouted 2 page(s). Discovered 1 structured schema entity block(s).')).toBe('done');
    expect(missionControlCardBadge('failed', 'Page fetch failed.')).toBe('not_measured');

    const events = (Object.keys(CREW_PROFILES) as AgentRole[]).map((role) => ({
      id: role,
      timestamp: 1,
      agentRole: role,
      agentName: CREW_PROFILES[role].name,
      phase: 'done',
      message:
        role === 'scout'
          ? 'Page fetch failed. On-page evidence not measured.'
          : role === 'playbook_auditor'
            ? 'Compliance audit finished. Health score not measured: no page evidence.'
            : 'Step finished.',
      status: 'completed' as const,
    }));
    const html = renderToStaticMarkup(
      createElement(AgentMissionControl, {
        events,
        isComplete: true,
        measurementStatus: 'not_measured',
      }),
    );
    expect(html).toContain('Not measured');
    expect(html).toContain('On-page evidence not measured');
    expect(html).toContain('Health score not measured');
    expect(html).toContain('NOT MEASURED');
    expect(html).not.toContain('100% COMPLETE');
  });

  it('does not claim ground-truth in the critic start line when evidence is missing', () => {
    expect(criticStartMessage(false)).toBe(
      'No page or search evidence to verify. Findings were not measured against live data.',
    );
    expect(criticStartMessage(false).toLowerCase()).not.toContain('ground-truth');
    expect(criticStartMessage(false).toLowerCase()).not.toContain('ground truth');
    expect(criticStartMessage(true).toLowerCase()).not.toContain('ground-truth');
  });
});

describe('Pricing display labels', () => {
  it('shows locked USD amounts and keeps Stars sublines', () => {
    expect(pricingTiers.map((tier) => [tier.id, tier.priceLabel, tier.stars, tier.ton])).toEqual([
      ['starter', 'US$49', '2,500 Stars', '15 TON'],
      ['growth', 'US$149', '7,500 Stars', '45 TON'],
      ['agency', 'US$349', '18,000 Stars', '120 TON'],
    ]);
  });
});

describe('Instant Audit degraded provider failures', () => {
  it('keeps health null when a page exists but the auth circuit is open', async () => {
    noteHostedAuthFailure(401, 'firecrawl');
    const page: ScrapedPageEvidence = {
      url: 'https://example.com',
      title: 'Example',
      h1s: ['Example'],
      schemasFound: [],
      wordCount: 400,
      rawTextSnippet: 'Example publishes enough product detail for a real page audit.',
    };
    const result = await playbookAuditorAgent.execute('AEO', [page], [], null, noop);
    expect(result.healthScore).toBeNull();
    expect(result.findings).toEqual([]);
  });

  it('does not claim a memory sync on an empty context, and does claim one when measured', async () => {
    const extract = vi.spyOn(mem0MemoryEngine, 'extractAndSyncAuditContext');
    const skipped: string[] = [];
    await applyMemorySync(createInitialAuditContext('https://example.com'), (event) => {
      skipped.push(event.message);
    });
    expect(extract).not.toHaveBeenCalled();
    expect(skipped.join(' ')).not.toMatch(/Synced \d+ autonomous memory/);
    expect(memorySyncPlan({
      deltaCount: 0,
      measurementStatus: 'not_measured',
      hasEvidence: false,
      authBlocked: false,
    }).message).not.toMatch(/Synced \d+ autonomous memory/);

    extract.mockRestore();
    const measured = createInitialAuditContext('https://measured.example');
    measured.measurementStatus = 'measured';
    measured.healthScore = 81;
    measured.citationRatePercent = 22;
    measured.shareOfVoiceScore = 18;
    measured.scrapedPages = [{
      url: 'https://measured.example',
      title: 'Measured',
      h1s: ['Measured'],
      schemasFound: [],
      wordCount: 220,
      rawTextSnippet: 'A measured page with enough words to count as evidence.',
    }];
    const synced: string[] = [];
    await applyMemorySync(measured, (event) => {
      synced.push(event.message);
    });
    expect(synced.join(' ')).toMatch(/Synced \d+ autonomous memory/);
    mem0MemoryEngine.clear();
  });

  it('returns null metrics after Firecrawl, Tavily, and Jina 401s and hides invented scores', async () => {
    installHostedWeb();
    expect(configService.isLocalSerpEnabled()).toBe(false);
    vi.spyOn(configService, 'getFirecrawlKey').mockReturnValue('fc-test-key');
    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('tv-test-key');
    vi.spyOn(configService, 'getCrawlerProvider').mockReturnValue('auto');
    vi.spyOn(configService, 'getSitewideEvidenceMode').mockReturnValue('smart');
    const localScrape = vi.spyOn(patchrightClient, 'scrape');
    const mapSpy = vi.spyOn(firecrawlService, 'mapUrl');
    const tavilySpy = vi.spyOn(tavilyService, 'search');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const events: AgentActivityEvent[] = [];
    const result = await crewOrchestrator.runAuditCrew('https://example.com', 'AEO', null, (event) => {
      events.push(event);
    });

    expect(result.citationRatePercent).toBeNull();
    expect(result.shareOfVoiceScore).toBeNull();
    expect(result.healthScore).toBeNull();
    expect(result.measurementStatus).toBe('not_measured');
    expect(result.attestation).toBeUndefined();
    expect(mapSpy).not.toHaveBeenCalled();
    expect(tavilySpy).not.toHaveBeenCalled();
    const firecrawlCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes('firecrawl.dev')).length;
    expect(firecrawlCalls).toBeLessThanOrEqual(1);
    const loopbackCalls = fetchMock.mock.calls.filter((call) => /localhost|127\.0\.0\.1/i.test(String(call[0])));
    expect(loopbackCalls).toEqual([]);
    expect(localScrape).not.toHaveBeenCalled();

    const decision = events.find((event) => event.phase === 'provider_decisions');
    expect(decision?.message).toMatch(/Page fetch:/);
    expect(decision?.message).toMatch(/Search/);
    expect(result.errors.some((err) => err.startsWith('provider_decisions '))).toBe(true);

    const joined = events.map((event) => event.message).join('\n');
    expect(joined).not.toMatch(/Synced \d+ autonomous memory/);
    expect(joined).not.toMatch(/production-grade/i);
    expect(joined).not.toMatch(/Share-of-Voice: \d+/);
    expect(joined).not.toMatch(/Health Score: \d+/);

    const mission = renderToStaticMarkup(createElement(AgentMissionControl, {
      events,
      isComplete: true,
      measurementStatus: 'not_measured',
    }));
    expect(mission).not.toMatch(/\d+%/);
    expect(mission).not.toMatch(/Share-of-Voice: \d+/);
    expect(mission).not.toMatch(/Health Score: \d+/);
    expect(mission).toContain('NOT MEASURED');
    expect(mission).not.toContain('100% COMPLETE');

    const summary = buildGuestScoutSummary({
      targetUrl: result.targetUrl,
      measurementStatus: result.measurementStatus,
      measurementReason: result.measurementReason,
      citationRatePercent: result.citationRatePercent,
      shareOfVoiceScore: result.shareOfVoiceScore,
      healthScore: result.healthScore,
      scrapedPageCount: result.scrapedPages.length,
      serpCount: result.serpEvidence.length,
      findings: result.findings.map((finding) => ({ title: finding.title })),
      errors: result.errors,
      plainEnglishBrief: result.plainEnglishBrief,
      hostedRail: 'byok_or_signin',
    });
    const guestHtml = renderToStaticMarkup(createElement(GuestScoutSummaryPanel, { summary }));
    expect(summary.degraded).toBe(true);
    expect(guestHtml).toContain('Live data unavailable');
    expect(guestHtml).not.toMatch(/\d+%/);
    expect(guestHtml).not.toMatch(/Share-of-Voice: \d+/);
    expect(guestHtml).not.toMatch(/Health Score: \d+/);

    const reportHtml = renderToStaticMarkup(createElement(ReportDisplay, {
      markdownText: 'Scout notes without a live score.',
      hideAgencyActions: true,
      suppressLiveMetrics: true,
      empiricalSummary: {
        targetDomain: 'example.com',
        brandName: 'Example',
        totalQueriesTested: 0,
        queriesCitedCount: 0,
        citationRatePercent: 45,
        topCitedCompetitor: null,
        evidenceList: [],
        entityClarityScore: 73,
        lastAudited: 1,
        measurementStatus: 'not_measured',
      },
      shareOfVoice: {
        targetDomain: 'example.com',
        brandName: 'Example',
        measuredAt: 1,
        totalPrompts: 4,
        mentionCoveragePercent: 43,
        citationCoveragePercent: 43,
        brandCitationSharePercent: 43,
        slices: [],
        formula: 'observed',
        method: 'observed',
      },
    }));
    expect(reportHtml).toContain('Live data unavailable');
    expect(reportHtml).not.toContain('45%');
    expect(reportHtml).not.toContain('43%');
    expect(reportHtml).not.toMatch(/Health Score: \d+/);
    expect(reportHtml).not.toMatch(/Share-of-Voice: \d+/);
  });

  it('does not call generateAuditReport for a guest degraded run and clears Scanning', async () => {
    const reportSpy = vi.spyOn(geminiService, 'generateAuditReport').mockResolvedValue({
      text: 'invented 45%',
      sources: [],
    } as Awaited<ReturnType<typeof geminiService.generateAuditReport>>);
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com',
      measurementStatus: 'not_measured',
      citationRatePercent: 45,
      shareOfVoiceScore: 43,
      healthScore: 73,
      scrapedPageCount: 1,
      serpCount: 0,
      findings: [],
      errors: ['provider_auth_failed'],
      hostedRail: 'byok_or_signin',
    });
    let loading = true;
    const crew = Promise.resolve({ measurementStatus: 'not_measured' as const });
    await crew;
    loading = false;
    const report = await generateAuditReportUnlessDegraded({
      isGuest: true,
      summary,
      measurementStatus: 'not_measured',
      formattedUrl: 'https://example.com',
      targetFocus: 'AEO',
      dna: null,
      lenses: [],
    });
    expect(loading).toBe(false);
    expect(report).toBeNull();
    expect(reportSpy).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(createElement(
      'button',
      { type: 'button', disabled: loading },
      instantAuditPrimaryLabel(loading, false),
    ));
    expect(html).not.toContain('Scanning');
    expect(html).toContain('Run quick scout');
    expect(html).not.toContain('disabled');
  });

  it('does not call generateAuditReport for a signed-in degraded run', async () => {
    const reportSpy = vi.spyOn(geminiService, 'generateAuditReport').mockResolvedValue({
      text: 'invented 45%',
      sources: [],
    } as Awaited<ReturnType<typeof geminiService.generateAuditReport>>);
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com',
      measurementStatus: 'not_measured',
      citationRatePercent: null,
      shareOfVoiceScore: null,
      healthScore: null,
      scrapedPageCount: 0,
      serpCount: 0,
      findings: [],
      errors: ['provider_auth_failed'],
      hostedRail: 'signed_in_hosted',
    });
    expect(summary.degraded).toBe(true);
    expect(summary.badges.every((badge) => badge.status === 'not_measured' && badge.value == null)).toBe(true);
    const report = await generateAuditReportUnlessDegraded({
      isGuest: false,
      summary,
      measurementStatus: 'not_measured',
      formattedUrl: 'https://example.com',
      targetFocus: 'AEO',
      dna: null,
      lenses: [],
    });
    expect(report).toBeNull();
    expect(reportSpy).not.toHaveBeenCalled();
  });

  it('calls generateAuditReport for a signed-in measured run', async () => {
    const reportSpy = vi.spyOn(geminiService, 'generateAuditReport').mockResolvedValue({
      text: 'measured brief',
      sources: [],
    } as Awaited<ReturnType<typeof geminiService.generateAuditReport>>);
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://example.com',
      measurementStatus: 'measured',
      citationRatePercent: 12,
      shareOfVoiceScore: 20,
      healthScore: 80,
      scrapedPageCount: 1,
      serpCount: 4,
      findings: [{ title: 'Add Organization schema' }],
      hostedRail: 'signed_in_hosted',
    });
    expect(summary.degraded).toBe(false);
    const report = await generateAuditReportUnlessDegraded({
      isGuest: false,
      summary,
      measurementStatus: 'measured',
      formattedUrl: 'https://example.com',
      targetFocus: 'AEO',
      dna: null,
      lenses: [],
    });
    expect(report?.text).toBe('measured brief');
    expect(reportSpy).toHaveBeenCalledTimes(1);
  });
});
