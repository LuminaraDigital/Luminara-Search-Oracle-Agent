import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentMissionControl, missionControlCardBadge, missionControlHeadline, missionControlProgressLabel } from '../../components/audit/AgentMissionControl';
import { GuestScoutSummaryPanel } from '../../components/audit/GuestScoutSummaryPanel';
import { generateAuditReportUnlessDegraded, instantAuditPrimaryLabel } from '../../components/audit/InstantAuditView';
import { ReportDisplay } from '../../components/audit/ReportDisplay';
import { pricingTiers } from '../../components/PricingPage';
import { executiveTranslatorAgent } from '../../services/agentCore/agents/executiveTranslatorAgent';
import { playbookAuditorAgent } from '../../services/agentCore/agents/playbookAuditorAgent';
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
    expect(events.map((event) => event.message).join(' ')).toContain('73/100');
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
      81,
      22,
      [],
      [],
      null,
      noop,
    );
    expect(measured).toContain('81/100');
    expect(measured).toContain('22%');
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
});
