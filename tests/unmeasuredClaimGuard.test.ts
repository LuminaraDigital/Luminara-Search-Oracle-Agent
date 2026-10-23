import { describe, expect, it } from 'vitest';
import { guardUnmeasuredClaims, visibleGroundingSources } from '../services/audit/unmeasuredClaimGuard';
import { EVIDENCE_LABEL_INSTRUCTION } from '../services/audit/evidencePromptLabels';

describe('unmeasured claim guard', () => {
  it('strips a third-party rating that the evidence does not contain', () => {
    const text = guardUnmeasuredClaims('Trustpilot lists 3.6/5. Add Organization schema.', {});
    expect(text).not.toMatch(/3\.6/);
    expect(text).not.toMatch(/Trustpilot/i);
    expect(text).toContain('Add Organization schema.');
  });

  it('hides review-site cards and rating titles we did not measure', () => {
    const sources = visibleGroundingSources([
      { uri: 'https://www.trustpilot.com/review/movida.com.au', title: 'MoVida is rated "Average" with 3.6 / 5 on Trustpilot' },
      { uri: 'https://alternativeto.net/software/movida/', title: 'AlternativeTo is rated "Excellent" with 4.4 / 5 on Trustpilot' },
      { uri: 'https://www.movida.com.au/', title: 'MoVida | Official Site' },
    ]);
    expect(sources.map((source) => source.title)).toEqual(['alternativeto.net', 'MoVida | Official Site']);
    expect(JSON.stringify(sources)).not.toMatch(/3\.6|4\.4|Trustpilot/i);
  });

  it('drops a review-site rating even when the snippet quotes the score', () => {
    const text = guardUnmeasuredClaims(
      'MoVida is rated "Average" with 3.6 / 5 on Trustpilot. Add Organization schema.',
      { evidenceText: 'MoVida is rated "Average" with 3.6 / 5 on Trustpilot' },
    );
    expect(text).not.toMatch(/3\.6/);
    expect(text).not.toMatch(/Trustpilot/i);
    expect(text).toContain('Add Organization schema.');
  });

  it('keeps a measured citation rate and a number that appears in the evidence', () => {
    const text = guardUnmeasuredClaims(
      'The citation rate is 89%. The page says 12% off. Technical health is fine.',
      { citationRatePercent: 89, evidenceText: 'banner: 12% off this week' },
    );
    expect(text).toContain('89%');
    expect(text).not.toContain('89% (unverified)');
    expect(text).toContain('12%');
    expect(text).not.toContain('12% (unverified)');
    expect(text).toContain('Technical health');
  });

  it('marks a percentage that was not measured and was not in the evidence', () => {
    const text = guardUnmeasuredClaims('Visibility rose 40% this month.', { citationRatePercent: 89 });
    expect(text).toContain('40% (unverified)');
    expect(text).not.toContain('89%');
  });

  it('tells the audit model not to state unsupported ratings', () => {
    expect(EVIDENCE_LABEL_INSTRUCTION).toContain('Never state a rating, review count, or statistic that is not in the evidence above.');
    expect(EVIDENCE_LABEL_INSTRUCTION).not.toContain('\n');
  });

  it('drops an AI-engine appearance claim when those engines were not measured and keeps the web search line', () => {
    const text = guardUnmeasuredClaims(
      [
        '# Luminara: Will AI mention Luminara Digital?',
        '',
        'Your site is being mentioned in AI\u2011driven results, but only because the brand name appears in plain text.No structured data exists, so AI has little confidence in the entity.Readability is low; long sentences may reduce quote-ability for AI citations.',
        'Your brand is mentioned in 6 of 9 web results this run collected.',
        'Found 9 web results through Tavily web search.',
        'ChatGPT: Not measured. Perplexity cites your homepage. Google AI Overviews include the brand.',
        'GPTBot and PerplexityBot are not blocked.',
        '```',
        'Your site is being mentioned in AI-driven results.',
        '```',
      ].join('\n'),
      { aiEnginesMeasured: false },
    );
    const body = text.split('```')[0] || '';
    expect(body).toContain('# Luminara: Web search check for Luminara Digital');
    expect(body).not.toMatch(/will ai mention/i);
    expect(body).not.toMatch(/ai[\s\u2010\u2011\u2012\u2013\u2014-]*driven/i);
    expect(body).not.toMatch(/Perplexity cites/i);
    expect(body).not.toMatch(/AI Overviews include/i);
    expect(text).toContain('No structured data exists, so AI has little confidence in the entity.');
    expect(text).toContain('Readability is low; long sentences may reduce quote-ability for AI citations.');
    expect(text).toContain('mentioned in 6 of 9 web results this run collected.');
    expect(text).toContain('Found 9 web results through Tavily web search.');
    expect(text).toContain('ChatGPT: Not measured.');
    expect(text).toContain('GPTBot and PerplexityBot are not blocked.');
    expect(text).toContain('```\nYour site is being mentioned in AI-driven results.\n```');
  });

  it('leaves an AI-driven sentence in place when the caller does not say the engines were unmeasured', () => {
    const sentence = 'Your site is being mentioned in AI-driven results.';
    expect(guardUnmeasuredClaims(sentence, {})).toBe(sentence);
    expect(guardUnmeasuredClaims(sentence, { aiEnginesMeasured: true })).toBe(sentence);
  });
});
