import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuestScoutSummaryPanel } from '../components/audit/GuestScoutSummaryPanel';
import { WeeklyDecisionCard } from '../components/audit/WeeklyDecisionCard';
import { executiveTranslatorAgent } from '../services/agentCore/agents/executiveTranslatorAgent';
import { remediationArchitectAgent } from '../services/agentCore/agents/remediationArchitectAgent';
import { auditHistoryService } from '../services/audit/auditHistoryService';
import { brandCandidates, clearRememberedBrand, readableStem, rememberScrapedBrand } from '../services/audit/brandName';
import { llmsTxtDraft } from '../services/audit/fixPackCopy';
import { buildGuestScoutSummary } from '../services/audit/guestScoutSummary';
import type { BoardFinding } from '../services/audit/findingBoardService';
import { sampleAiSaidFixtures } from '../services/audit/sampleAiSaidFixtures';

const primary: BoardFinding = {
  id: 'fix-1',
  domain: 'raywhite.com.au',
  stableKey: 'fix-1',
  category: 'content_quality',
  severity: 'high',
  title: 'Add the agency name to the homepage title',
  description: 'The homepage title does not name the agency.',
  status: 'open',
};

afterEach(() => {
  clearRememberedBrand();
  auditHistoryService.clear();
  vi.unstubAllGlobals();
});

describe('playtest brand name', () => {
  it('collects a readable name from a title and a search result, and title-cases a bare stem', () => {
    expect(brandCandidates({
      title: 'Home | Ray White',
      searchTitles: ['Ray White Real Estate | raywhite.com.au', 'Home'],
    })).toEqual(['Ray White', 'Ray White Real Estate']);
    expect(readableStem('https://www.raywhite.com.au')).toBe('Raywhite');
    expect(readableStem('ray-white.com')).toBe('Ray White');
  });

  it('names the brand once in a sample prompt and in the brief', async () => {
    const named = sampleAiSaidFixtures('https://www.raywhite.com.au', 'Ray White');
    expect(named[0].prompt).toBe('Best providers like Ray White');
    expect(named[1].prompt).toBe('Who is recommended instead of Ray White?');
    expect(named.map((row) => `${row.prompt} ${row.excerpt}`).join('\n')).not.toContain('raywhite.com.au');

    const fallback = sampleAiSaidFixtures('https://www.raywhite.com.au');
    expect(fallback[0].prompt).toBe('Best providers like Raywhite');
    expect(fallback[0].prompt).not.toContain('raywhite.com.au');

    const brief = await executiveTranslatorAgent.execute(
      'https://www.raywhite.com.au',
      null,
      null,
      [],
      [],
      null,
      () => {},
      'Ray White',
    );
    expect(brief).toContain('### What This Means For Ray White');
    expect(brief).not.toContain('raywhite');

    const stemmed = await executiveTranslatorAgent.execute(
      'https://www.raywhite.com.au',
      null,
      null,
      [],
      [],
      null,
      () => {},
    );
    expect(stemmed).toContain('### What This Means For Raywhite');
  });

  it('shows the brand as the heading and the domain under it', () => {
    const summary = buildGuestScoutSummary({
      targetUrl: 'https://www.raywhite.com.au',
      brand: 'Ray White',
      measurementStatus: 'not_measured',
      citationRatePercent: null,
      shareOfVoiceScore: null,
      healthScore: null,
      scrapedPageCount: 0,
      serpCount: 3,
      findings: [],
      hostedRail: 'signed_in_hosted',
    });
    const html = renderToStaticMarkup(createElement(GuestScoutSummaryPanel, { summary }));
    expect(html).toContain('>Ray White<');
    expect(html).toContain('>www.raywhite.com.au<');
  });
});

describe('playtest llms.txt placeholder', () => {
  it('uses a placeholder and a one-line note until a name is known', async () => {
    const draft = llmsTxtDraft('raywhite.com.au');
    expect(draft.startsWith('# <Your agency name>\n')).toBe(true);
    expect(draft).not.toContain('Template:');
    const patches = await remediationArchitectAgent.execute('https://raywhite.com.au', [], null, () => {}, null);
    const snippet = patches.find((patch) => patch.filename === 'llms.txt')?.proposedSnippet || '';
    expect(snippet).toContain('# <Your agency name>');
    expect(snippet).not.toContain('Template:');
    const html = renderToStaticMarkup(createElement(WeeklyDecisionCard, {
      domain: 'raywhite.com.au',
      primary,
      findings: [primary],
      commitment: null,
    }));
    expect(html).toContain('Replace &lt;Your agency name&gt; with the name you use.');
    expect(html).toContain('# &lt;Your agency name&gt;');
    expect(html).not.toContain('Template:');

    rememberScrapedBrand('raywhite.com.au', 'Ray White');
    const namedHtml = renderToStaticMarkup(createElement(WeeklyDecisionCard, {
      domain: 'raywhite.com.au',
      primary,
      findings: [primary],
      commitment: null,
    }));
    expect(namedHtml).toContain('Best providers like Ray White');
    expect(namedHtml).not.toContain('Your agency name');
    expect(namedHtml).not.toContain('raywhite.com.au customers');
  });
});

describe('playtest past reports', () => {
  it('keeps one row when the same audit id is saved twice', () => {
    auditHistoryService.record({
      id: 'audit-raywhite-1',
      domain: 'https://www.raywhite.com.au/richmond',
      focus: 'AEO',
      reportText: 'First write of the Ray White audit is long enough to store as the report body.',
      measuredAt: 1_700_000_000_000,
    });
    auditHistoryService.record({
      id: 'audit-raywhite-1',
      domain: 'https://www.raywhite.com.au/richmond',
      focus: 'AEO',
      reportText: 'Second write of the Ray White audit replaces the first report body.',
      measuredAt: 1_800_000_000_000,
    });
    auditHistoryService.record({
      id: 'audit-other',
      domain: 'https://example.com',
      focus: 'SEO',
      reportText: 'A different audit stays in the list beside the Ray White row.',
      measuredAt: 1_700_000_000_100,
    });

    const listed = auditHistoryService.list({ domain: 'raywhite.com.au' });
    expect(listed.map((row) => row.id)).toEqual(['audit-raywhite-1']);
    expect(listed[0].reportExcerpt).toBe('Second write of the Ray White audit replaces the first report body.');
    expect(listed[0].measuredAt).toBe(1_700_000_000_000);
    expect(auditHistoryService.list().map((row) => row.id).sort()).toEqual(['audit-other', 'audit-raywhite-1']);
  });

  it('collapses two stored rows that share an audit id', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    });
    const row = {
      id: 'audit-raywhite-1',
      domain: 'raywhite.com.au',
      focus: 'AEO',
      measuredAt: 1_700_000_000_000,
      healthScore: null,
      citationRatePercent: null,
      schemaGapCount: null,
      topCompetitor: null,
      competitorsMentioned: [],
      title: 'AEO audit · raywhite.com.au',
      summary: 'first',
      reportExcerpt: 'first body',
      tags: ['aeo'],
    };
    store.set(auditHistoryService.STORAGE_KEY, JSON.stringify([
      row,
      { ...row, summary: 'second', reportExcerpt: 'second body' },
    ]));
    const listed = auditHistoryService.list({ domain: 'raywhite.com.au' });
    expect(listed).toHaveLength(1);
    expect(listed[0].reportExcerpt).toBe('second body');
  });
});
