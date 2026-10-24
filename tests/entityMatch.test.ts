import { describe, expect, it } from 'vitest';
import { empiricalCitationService } from '../services/audit/empiricalCitationService';
import { formatCrewSerpForReport } from '../services/audit/reuseCrewEvidence';
import { scoutAuthoritySources } from '../services/visibility/authorityScoutService';
import { probeLlmAnswers } from '../services/visibility/llmAnswerProbeService';
import { competitorStrategistAgent, isExcludedCompetitorHost } from '../services/agentCore/agents/competitorStrategistAgent';
import type { EmpiricalEvidence } from '../services/audit/empiricalCitationService';
import type { SerpEvidenceItem } from '../services/agentCore/types';

function evidence(partial: Pick<EmpiricalEvidence, 'id' | 'query' | 'citedUrl' | 'brandCited'>): EmpiricalEvidence {
  return {
    intent: 'informational',
    targetDomain: 'luminara.digital',
    brandRank: null,
    snippet: '',
    competitorsCited: [],
    citationConfidence: 20,
    timestamp: 1,
    ...partial,
  };
}

function row(partial: Pick<SerpEvidenceItem, 'title' | 'url' | 'snippet'>): SerpEvidenceItem {
  return {
    query: 'luminara',
    engine: 'tavily',
    brandMentioned: false,
    ...partial,
  };
}

describe('audited entity matching', () => {
  it('cites luminara.digital and the legal name, and drops candle and institute namesakes', () => {
    const summary = empiricalCitationService.summarizePrefetchedCitations(
      'https://luminara.digital',
      'Luminara Digital',
      [],
      [
        {
          query: 'what is luminara digital',
          intent: 'informational',
          results: [
            { url: 'https://www.bonappetit.com/candles', title: 'Flameless candles', content: 'Luminara candles glow at dinner.' },
            { url: 'https://luminara.institute/', title: 'Luminara, Institute of Light', content: 'A living institute.' },
            { url: 'https://luminara.digital/about', title: 'About', content: 'Real-estate agency growth.' },
          ],
        },
        {
          query: 'best luminara alternative',
          intent: 'commercial',
          results: [
            { url: 'https://shop.luminara.com/pillars', title: 'Luminara candles', content: 'Buy flameless candles.' },
          ],
        },
        {
          query: 'luminara digital agency',
          intent: 'informational',
          results: [
            { url: 'https://news.example/story', title: 'Agency profile', content: 'Luminara Digital helps real-estate agencies.' },
          ],
        },
      ],
    );

    expect(summary.queriesCitedCount).toBe(2);
    expect(summary.evidenceList[0].brandCited).toBe(true);
    expect(summary.evidenceList[0].citedUrl).toBe('https://luminara.digital/about');
    expect(summary.evidenceList[1].brandCited).toBe(false);
    expect(summary.evidenceList[1].citedUrl).toBeNull();
    expect(summary.evidenceList[2].brandCited).toBe(true);
    expect(summary.evidenceList[2].citedUrl).toBe('https://news.example/story');
  });

  it('does not treat a bare stem as Acme Robotics, and does cite the full name', () => {
    const summary = empiricalCitationService.summarizePrefetchedCitations(
      'https://acmerobotics.com',
      'Acme Robotics',
      [],
      [
        {
          query: 'acme robotics reviews',
          intent: 'commercial',
          results: [
            { url: 'https://news.example/acme', title: 'Acme Robotics reviews', content: 'Acme Robotics ships warehouse bots.' },
          ],
        },
        {
          query: 'acme candles',
          intent: 'commercial',
          results: [
            { url: 'https://candles.example/acme', title: 'Acme candles', content: 'Acme candles for the table.' },
          ],
        },
      ],
    );

    expect(summary.queriesCitedCount).toBe(1);
    expect(summary.citationRatePercent).toBe(50);
    expect(summary.evidenceList[0].citedUrl).toBe('https://news.example/acme');
    expect(summary.evidenceList[1].brandCited).toBe(false);
  });

  it('omits namesake rows from report sources and does not tell the model to cite them', () => {
    const serp = formatCrewSerpForReport(
      [
        row({ title: 'Luminara Digital', url: 'https://luminara.digital/', snippet: 'Agency site.' }),
        row({ title: 'Luminara, Institute of Light', url: 'https://luminara.institute/', snippet: 'Institute of Light.' }),
        row({ title: 'These Are The Most Realistic Flameless Candles', url: 'https://www.bonappetit.com/candles', snippet: 'Luminara flameless candles.' }),
        row({ title: 'Rival agency', url: 'https://rival-agency.com/seo', snippet: 'Real-estate marketing.' }),
      ],
      { domain: 'luminara.digital', brandName: 'Luminara Digital' },
    );

    expect(serp?.sources.map((source) => source.uri)).toEqual([
      'https://luminara.digital/',
      'https://rival-agency.com/seo',
    ]);
    expect(serp?.contextText).toContain('They are not this business');
    expect(serp?.contextText).not.toContain('luminara.institute');
    expect(serp?.contextText).not.toContain('bonappetit.com');
  });

  it('does not recommend a citation on luminara.institute', () => {
    const institute: EmpiricalEvidence = evidence({
      id: '1',
      query: 'what is luminara',
      citedUrl: 'https://luminara.institute/',
      brandCited: false,
    });
    const reddit: EmpiricalEvidence = evidence({
      id: '2',
      query: 'agency tools',
      citedUrl: 'https://reddit.com/r/marketing',
      brandCited: false,
    });
    const scout = scoutAuthoritySources({
      targetDomain: 'luminara.digital',
      evidence: [institute, reddit],
      rawSources: [
        { uri: 'https://luminara.institute/', title: 'Luminara, Institute of Light' },
        { uri: 'https://reddit.com/r/marketing', title: 'Marketing thread' },
      ],
    });

    expect(scout.sources.map((source) => source.domain)).toEqual(['reddit.com']);
    expect(scout.topUntappedHub?.domain).toBe('reddit.com');
    expect(scout.topUntappedHub?.actionRecommendation).toBe(
      'Establish verified community presence or documentation thread on reddit.com.',
    );
    expect(JSON.stringify(scout)).not.toContain('luminara.institute');

    const onlyInstitute = scoutAuthoritySources({
      targetDomain: 'luminara.digital',
      evidence: [institute],
      rawSources: [{ uri: 'https://luminara.institute/', title: 'Luminara, Institute of Light' }],
    });
    expect(onlyInstitute.sources).toEqual([]);
    expect(onlyInstitute.topUntappedHub).toBeUndefined();
  });

  it('keeps a namesake host out of the competitor list', async () => {
    expect(isExcludedCompetitorHost('luminara.institute', 'luminara.digital')).toBe(true);
    expect(isExcludedCompetitorHost('bonappetit.com', 'luminara.digital')).toBe(false);

    const messages: string[] = [];
    const found = await competitorStrategistAgent.execute(
      'https://luminara.digital',
      null,
      [
        row({ title: 'Luminara candles', url: 'https://www.bonappetit.com/story/candles', snippet: 'Luminara flameless candles' }),
        row({ title: 'Agency rival', url: 'https://rival-agency.com/seo', snippet: 'Real estate marketing' }),
        row({ title: 'Institute', url: 'https://luminara.institute/', snippet: 'Institute of Light' }),
      ],
      (event) => { messages.push(event.message); },
    );
    expect(found.topCompetitors).toEqual([]);
    expect(found.competitorGaps).toEqual([]);
    expect(messages.join(' ')).toContain('No competitors found in this search sample.');
    expect(messages.join(' ')).not.toContain('rival-agency.com');
    expect(messages.join(' ')).not.toContain('keyword gap');
    expect(messages.join(' ')).not.toContain('competitor(s)');
    expect(messages.join(' ')).not.toContain('SERP');
  });

  it('does not count a candle or institute answer as an engine citation', async () => {
    const missed = await probeLlmAnswers({
      generate: async () => 'Luminara candles and the Luminara Institute of Light are unrelated products.',
      domain: 'luminara.digital',
      brand: 'Luminara Digital',
      queries: ['who is Luminara Digital'],
    });
    expect(missed.map((row) => row.cited)).toEqual([false, false, false]);

    const hit = await probeLlmAnswers({
      generate: async () => 'Luminara Digital publishes at luminara.digital.',
      domain: 'luminara.digital',
      brand: 'Luminara Digital',
      queries: ['who is Luminara Digital'],
    });
    expect(hit.map((row) => row.cited)).toEqual([true, true, true]);

    const robotics = await probeLlmAnswers({
      generate: async () => 'Acme Robotics publishes warehouse case studies.',
      domain: 'acmerobotics.com',
      brand: 'Acme Robotics',
      queries: ['acme robotics reviews'],
    });
    expect(robotics.map((row) => row.cited)).toEqual([true, true, true]);
  });
});
