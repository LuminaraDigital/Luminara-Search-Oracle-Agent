import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentMissionControl, missionControlHeadline } from '../../components/audit/AgentMissionControl';
import { pricingTiers } from '../../components/PricingPage';
import { executiveTranslatorAgent } from '../../services/agentCore/agents/executiveTranslatorAgent';
import { playbookAuditorAgent } from '../../services/agentCore/agents/playbookAuditorAgent';
import { scoutAgent } from '../../services/agentCore/agents/scoutAgent';
import { serpRadarAgent } from '../../services/agentCore/agents/serpRadarAgent';
import {
  CREW_PROFILES,
  createInitialAuditContext,
  deriveAuditMeasurement,
} from '../../services/agentCore/crewOrchestrator';
import type { AgentRole, ScrapedPageEvidence } from '../../services/agentCore/types';
import { empiricalCitationService } from '../../services/audit/empiricalCitationService';
import { configService } from '../../services/configService';
import { siteEvidencePackService } from '../../services/scraping/siteEvidencePack';
import { unifiedScraperService } from '../../services/scraping/unifiedScraper';
import { tavilyService } from '../../services/search/tavilyService';

const noop = () => {};

afterEach(() => {
  vi.restoreAllMocks();
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
    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('');
    vi.spyOn(configService, 'isLocalSerpEnabled').mockReturnValue(false);
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
  });

  it('does not invent metrics when a configured search provider returns no rows', async () => {
    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('test-key');
    vi.spyOn(configService, 'isLocalSerpEnabled').mockReturnValue(false);
    vi.spyOn(tavilyService, 'search').mockResolvedValue({ query: 'q', results: [] });
    const result = await serpRadarAgent.execute('example.com', null, noop);
    expect(result.citationRatePercent).toBeNull();
    expect(result.shareOfVoiceScore).toBeNull();
  });

  it('calculates citation rate only from returned SERP rows', async () => {
    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('test-key');
    vi.spyOn(configService, 'isLocalSerpEnabled').mockReturnValue(false);
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

  it('scores health when a scraped page has real content', async () => {
    const page: ScrapedPageEvidence = {
      url: 'https://example.com',
      title: 'Example',
      h1s: ['Example'],
      schemasFound: [{ type: 'Organization', rawJson: '{}', isValid: true }],
      wordCount: 400,
      rawTextSnippet: 'Example publishes enough product detail for a real page audit.',
    };
    const result = await playbookAuditorAgent.execute('AEO', [page], [], null, noop);
    expect(result.healthScore).toBe(85);
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
    vi.spyOn(configService, 'getTavilyKey').mockReturnValue('');
    vi.spyOn(configService, 'isLocalSerpEnabled').mockReturnValue(false);
    const summary = await empiricalCitationService.probeDomainCitations('https://example.com', 'Example');
    expect(summary.measurementStatus).toBe('not_measured');
    expect(summary.citationRatePercent).toBeNull();
    expect(summary.entityClarityScore).toBeNull();
    expect(summary.evidenceList).toEqual([]);
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
    expect(html).toContain('100% COMPLETE');
    expect(html).toContain('Audit finished. Some signals were not measured.');
    expect(html).toContain('agent progress, not evidence quality');
    expect(html).not.toContain('ground-truth');
    expect(html).not.toContain('45%');
  });
});

describe('Pricing display labels', () => {
  it('shows locked USD amounts and keeps Stars sublines', () => {
    expect(pricingTiers.map((tier) => [tier.id, tier.priceLabel, tier.stars])).toEqual([
      ['starter', 'US$49', '2,500 Stars'],
      ['growth', 'US$149', '7,500 Stars'],
      ['agency', 'US$349', '18,000 Stars'],
    ]);
  });
});
