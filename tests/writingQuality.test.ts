import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/apiClient', () => ({
  sidecarFetch: vi.fn(),
  isSidecarConfiguredOnServer: vi.fn(() => false),
  isProviderConfiguredOnServer: vi.fn(() => false),
  isProxyMode: vi.fn(() => false),
  providerFetch: vi.fn(),
}));

import { sidecarFetch } from '../services/apiClient';
import {
  writingQualityService,
  computeReadability,
  scoreReport,
  gradeFor,
  extractSchemaStrings,
  mapCategory,
} from '../services/audit/writingQualityService';

const EASY = 'We fix leaky taps. Call us today. We come to your home. Our team is friendly. Prices are fair. You will be happy.';
const HARD = 'Notwithstanding the aforementioned considerations, the organization endeavours to systematically operationalize multidisciplinary methodologies which, when contextualized within contemporary infrastructural paradigms, facilitate the comprehensive optimization of stakeholder-oriented deliverables across heterogeneous institutional environments.';

function jsonResponse(body: unknown, contentType = 'application/json'): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': contentType } });
}

function ltMatch(overrides: Record<string, any>) {
  return {
    message: 'Possible spelling mistake found.',
    shortMessage: 'Spelling mistake',
    offset: 0,
    length: 4,
    replacements: [{ value: 'fixed' }],
    context: { text: 'Teh cat sat.', offset: 0, length: 3 },
    rule: { id: 'MORFOLOGIK_RULE_EN_US', description: 'Possible spelling mistake', issueType: 'misspelling', category: { id: 'TYPOS', name: 'Possible Typo' } },
    ...overrides,
  };
}

describe('computeReadability', () => {
  it('rates a short plain paragraph as easier than a dense one', () => {
    const easy = computeReadability(EASY);
    const hard = computeReadability(HARD);
    expect(easy.fleschReadingEase).toBeGreaterThan(hard.fleschReadingEase);
    expect(easy.fleschReadingEase).toBeGreaterThanOrEqual(80);
    expect(easy.label).toMatch(/easy/i);
    expect(hard.label).toBe('Hard to read');
    expect(hard.longSentences).toBe(1);
    expect(easy.longSentences).toBe(0);
    expect(easy.sentenceCount).toBe(6);
    expect(easy.wordCount).toBe(23);
  });

  it('handles empty text without dividing by zero', () => {
    const r = computeReadability('');
    expect(r.wordCount).toBe(0);
    expect(r.sentenceCount).toBe(0);
    expect(r.fleschReadingEase).toBe(0);
  });
});

describe('scoreReport / gradeFor', () => {
  const none = { spelling: 0, grammar: 0, style: 0, clarity: 0, other: 0 };

  it('starts at 100 with no issues and easy readability', () => {
    expect(scoreReport(none, 200, 75)).toEqual({ score: 100, grade: 'Excellent' });
  });

  it('subtracts weighted issues per 100 words', () => {
    // 100 words: 1 spelling (6) + 1 grammar (5) + 1 style (2) + 1 clarity (2) + 1 other (1) = 16
    expect(scoreReport({ spelling: 1, grammar: 1, style: 1, clarity: 1, other: 1 }, 100, 70).score).toBe(84);
    // 200 words halves the density
    expect(scoreReport({ spelling: 2, grammar: 0, style: 0, clarity: 0, other: 0 }, 200, 70).score).toBe(94);
  });

  it('applies the readability penalty, capped at 15', () => {
    expect(scoreReport(none, 100, 60).score).toBe(100);
    expect(scoreReport(none, 100, 30).score).toBe(90); // (60-30)/3 = 10
    expect(scoreReport(none, 100, 0).score).toBe(85);  // capped at 15
  });

  it('maps score thresholds to grades', () => {
    expect(gradeFor(85)).toBe('Excellent');
    expect(gradeFor(84)).toBe('Good');
    expect(gradeFor(70)).toBe('Good');
    expect(gradeFor(69)).toBe('Needs work');
    expect(gradeFor(50)).toBe('Needs work');
    expect(gradeFor(49)).toBe('Poor');
  });
});

describe('mapCategory', () => {
  it('maps service issue types to plain categories', () => {
    expect(mapCategory({ rule: { issueType: 'misspelling', category: { id: 'TYPOS' } } })).toBe('spelling');
    expect(mapCategory({ rule: { issueType: 'grammar', category: { id: 'GRAMMAR' } } })).toBe('grammar');
    expect(mapCategory({ rule: { issueType: 'style', category: { id: 'STYLE' } } })).toBe('style');
    expect(mapCategory({ rule: { issueType: 'typographical', category: { id: 'TYPOGRAPHY' } } })).toBe('style');
    expect(mapCategory({ rule: { id: 'TOO_LONG_SENTENCE', issueType: 'style', category: { id: 'STYLE' } }, message: 'This sentence is too long' })).toBe('clarity');
    expect(mapCategory({ rule: { issueType: 'uncategorized', category: { id: 'MISC' } } })).toBe('other');
  });
});

describe('writingQualityService.checkText', () => {
  beforeEach(() => {
    vi.mocked(sidecarFetch).mockReset();
  });

  it('parses a service response, categorises issues and dedupes near-duplicates', async () => {
    vi.mocked(sidecarFetch).mockResolvedValueOnce(jsonResponse({
      language: { code: 'en-US', detectedLanguage: { code: 'en' } },
      matches: [
        ltMatch({ offset: 0 }),
        ltMatch({ offset: 3 }), // duplicate message within 5 chars -> skipped
        ltMatch({ offset: 40, message: 'Use "an" before a vowel sound.', shortMessage: '', rule: { id: 'EN_A_VS_AN', issueType: 'grammar', category: { id: 'GRAMMAR' } } }),
        ltMatch({ offset: 80, message: 'This sentence is very long.', rule: { id: 'TOO_LONG_SENTENCE', issueType: 'style', category: { id: 'STYLE' } } }),
      ],
    }));

    const text = Array(12).fill('The quick brown fox jumps over the lazy dog.').join(' ');
    const report = await writingQualityService.checkText(text);

    expect(sidecarFetch).toHaveBeenCalledTimes(1);
    const [id, path, init] = vi.mocked(sidecarFetch).mock.calls[0];
    expect(id).toBe('languagetool');
    expect(path).toBe('/v2/check');
    expect(String(init?.body)).toContain('language=auto');

    expect(report.available).toBe(true);
    expect(report.language).toBe('en');
    expect(report.issues).toHaveLength(3);
    expect(report.counts).toEqual({ spelling: 1, grammar: 1, style: 0, clarity: 1, other: 0 });
    expect(report.issues[0].suggestion).toBe('fixed');
    expect(report.issues[0].snippet).toBe('Teh');
    expect(report.topFixes.length).toBeGreaterThan(0);
    expect(report.topFixes.length).toBeLessThanOrEqual(5);
    expect(report.topFixes[0]).toContain('Possible spelling mistake');
    expect(report.score).toBeLessThan(100);
    expect(report.wordCount).toBe(108);
  });

  it('treats an HTML (non-JSON) answer as unavailable but still reports readability', async () => {
    vi.mocked(sidecarFetch).mockResolvedValueOnce(new Response('<!doctype html><html><body>SPA</body></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const report = await writingQualityService.checkText(EASY);
    expect(report.available).toBe(false);
    expect(report.issues).toEqual([]);
    expect(report.readability.fleschReadingEase).toBeGreaterThan(60);
    expect(report.score).toBe(100);
    expect(report.grade).toBe('Excellent');
    expect(writingQualityService.summaryForLlm(report)).toContain('Grammar service not measured');
  });

  it('returns a readability-only report when the service is unreachable (null) or throws', async () => {
    vi.mocked(sidecarFetch).mockResolvedValueOnce(null);
    const r1 = await writingQualityService.checkText(HARD);
    expect(r1.available).toBe(false);
    expect(r1.grade).toBe('Excellent'); // readability penalty alone caps at 15 -> 85
    expect(r1.score).toBe(85);
    expect(r1.aiAnswerNote).toContain('past 25 words');

    vi.mocked(sidecarFetch).mockRejectedValueOnce(new Error('boom'));
    const r2 = await writingQualityService.checkText(EASY);
    expect(r2.available).toBe(false);
    expect(r2.aiAnswerNote).toBe('Clear, short sentences — easy for AI assistants to quote.');
  });

  it('limits the text sent to the service to maxChars', async () => {
    vi.mocked(sidecarFetch).mockResolvedValueOnce(jsonResponse({ matches: [] }));
    const report = await writingQualityService.checkText('word '.repeat(100), { maxChars: 50 });
    expect(report.checkedChars).toBe(50);
  });
});

describe('extractSchemaStrings', () => {
  it('collects prose fields with paths and ignores URLs, @-keys, dates and ids', () => {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      name: 'Acme Plumbing',
      url: 'https://acme.example',
      description: 'We fix leaks fast.',
      datePublished: '2024-01-01',
      identifier: 'abc-123',
      mainEntity: [
        { '@type': 'Question', name: 'Do you work weekends?', acceptedAnswer: { '@type': 'Answer', text: 'Yes, we do.' } },
        { '@type': 'Question', name: 'https://not-prose.example', acceptedAnswer: { text: 'Second answer here.' } },
      ],
    };
    const entries = extractSchemaStrings(schema);
    expect(entries.map(e => e.field)).toEqual([
      'name',
      'description',
      'mainEntity[0].name',
      'mainEntity[0].acceptedAnswer.text',
      'mainEntity[1].acceptedAnswer.text',
    ]);
    expect(entries.find(e => e.field === 'description')?.value).toBe('We fix leaks fast.');
  });
});

describe('writingQualityService.checkSchemaText', () => {
  beforeEach(() => {
    vi.mocked(sidecarFetch).mockReset();
  });

  it('attaches the schema field to each issue based on offset', async () => {
    const schema = JSON.stringify({
      '@type': 'FAQPage',
      description: 'Teh best plumbers.',
      mainEntity: [
        { name: 'Q1?', acceptedAnswer: { text: 'Fine answer.' } },
        { name: 'Q2?', acceptedAnswer: { text: 'We has vans.' } },
      ],
    });
    // Text lines: "Teh best plumbers." (0-18) \n "Q1?" (19-22) \n "Fine answer." (23-35) \n "Q2?" (36-39) \n "We has vans." (40-52)
    vi.mocked(sidecarFetch).mockImplementationOnce(async (_id, _path, init) => {
      const text = new URLSearchParams(String(init?.body)).get('text') || '';
      const i1 = text.indexOf('Teh');
      const i2 = text.indexOf('We has');
      return jsonResponse({
        matches: [
          ltMatch({ offset: i1, length: 3, context: { text: 'Teh best', offset: 0, length: 3 } }),
          ltMatch({ offset: i2 + 3, length: 3, message: 'Subject-verb agreement.', context: { text: 'We has vans.', offset: 3, length: 3 }, rule: { id: 'AGREEMENT', issueType: 'grammar', category: { id: 'GRAMMAR' } } }),
        ],
      });
    });

    const report = await writingQualityService.checkSchemaText(schema);
    expect(report.available).toBe(true);
    expect(report.issues).toHaveLength(2);
    expect(report.issues[0].field).toBe('description');
    expect(report.issues[1].field).toBe('mainEntity[1].acceptedAnswer.text');
    expect(report.topFixes.some(f => f.startsWith('description:'))).toBe(true);
  });

  it('tolerates invalid JSON', async () => {
    const report = await writingQualityService.checkSchemaText('{not json');
    expect(report.available).toBe(false);
    expect(report.wordCount).toBe(0);
    expect(sidecarFetch).not.toHaveBeenCalled();
  });
});
