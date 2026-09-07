import { describe, expect, it } from 'vitest';
import { planSearch, extractDomain, topicWords } from '../services/search/searchPlanner';
import type { BusinessDNA } from '../types';

const dna: BusinessDNA = {
  name: 'Bright Smile Dental',
  mission: 'm', usp: 'u', targetAudience: 't',
  competitors: ['Aspen Dental', 'SmileDirect'],
  perceivedGaps: [],
  rawContext: 'Clinic site brightsmile.example',
};

describe('extractDomain', () => {
  it('finds URLs and bare domains', () => {
    expect(extractDomain('audit https://www.acme.com/pricing please')).toBe('acme.com');
    expect(extractDomain('how does acme.io rank')).toBe('acme.io');
    expect(extractDomain('no domain here')).toBeNull();
  });
});

describe('topicWords', () => {
  it('drops stopwords and URLs', () => {
    expect(topicWords('How do I show up in AI answers for my dental clinic https://x.com')).toBe('show up AI answers dental clinic');
  });
});

describe('planSearch', () => {
  it('returns null for small talk', () => {
    expect(planSearch('what can you help me with?')).toBeNull();
  });

  it('anchors on the brand when DNA is linked and no domain is given', () => {
    const plan = planSearch('how do I show up in AI answers for dental implants', dna);
    expect(plan).not.toBeNull();
    expect(plan!.queries[0]).toContain('Bright Smile Dental');
    expect(plan!.queries.some(q => q.includes('AI Overviews'))).toBe(true);
  });

  it('adds a competitor query when the prompt asks about competitors', () => {
    const plan = planSearch('compare my visibility with competitors for dental implants', dna);
    expect(plan!.queries.some(q => q.includes('Aspen Dental'))).toBe(true);
    expect(plan!.queries.length).toBeLessThanOrEqual(3);
  });

  it('prefers a domain from the prompt over the brand', () => {
    const plan = planSearch('audit acme.com for schema gaps', dna);
    expect(plan!.queries[0].startsWith('acme.com')).toBe(true);
  });
});
