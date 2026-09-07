import { describe, expect, it } from 'vitest';
import { shouldSearch, toSearchQuery, MAX_SEARCH_QUERY_CHARS } from '../services/search/searchIntent';

describe('shouldSearch', () => {
  it('skips small talk and short prompts', () => {
    expect(shouldSearch('hi')).toBe(false);
    expect(shouldSearch('what can you help me with?')).toBe(false);
    expect(shouldSearch('thanks, that was useful')).toBe(false);
  });

  it('searches for URLs, domains and research intent', () => {
    expect(shouldSearch('audit https://example.com for AEO gaps')).toBe(true);
    expect(shouldSearch('how does acme.com rank for dentist near me')).toBe(true);
    expect(shouldSearch('who are the main competitors of Notion')).toBe(true);
  });
});

describe('toSearchQuery', () => {
  it('collapses whitespace and caps length for Tavily', () => {
    const long = 'word '.repeat(200);
    expect(toSearchQuery(long).length).toBeLessThanOrEqual(MAX_SEARCH_QUERY_CHARS);
    expect(toSearchQuery('  a   b\n\nc ')).toBe('a b c');
  });
});
