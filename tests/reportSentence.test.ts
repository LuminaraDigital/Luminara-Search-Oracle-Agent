import { describe, expect, it } from 'vitest';
import {
  countPhrase,
  findingSummary,
  indefiniteArticle,
  joinList,
  tidySentence,
  withArticle,
} from '../services/audit/reportSentence';

describe('report sentence assembly', () => {
  it('picks a or an from the next word', () => {
    expect(indefiniteArticle('issue')).toBe('an');
    expect(indefiniteArticle('page')).toBe('a');
    expect(indefiniteArticle('FAQ')).toBe('an');
    expect(indefiniteArticle('URL')).toBe('a');
    expect(withArticle('issue')).toBe('an issue');
    expect(withArticle('result')).toBe('a result');
  });

  it('counts zero, one, two, and many', () => {
    expect(countPhrase(0, 'issue')).toBe('0 issues');
    expect(countPhrase(1, 'issue')).toBe('1 issue');
    expect(countPhrase(2, 'issue')).toBe('2 issues');
    expect(countPhrase(12, 'issue')).toBe('12 issues');
    expect(countPhrase(1, 'page', 'pages')).toBe('1 page');
    expect(countPhrase(2, 'page', 'pages')).toBe('2 pages');
  });

  it('joins zero, one, two, and many items', () => {
    expect(joinList([])).toBe('');
    expect(joinList(['A'])).toBe('A');
    expect(joinList(['A', 'B'])).toBe('A and B');
    expect(joinList(['A', 'B', 'C'])).toBe('A, B and C');
    expect(joinList(['A', 'B', 'C', 'D'])).toBe('A, B, C and D');
    expect(joinList(['Short page', 'This tag is missing'])).toBe('Short page and this tag is missing');
    expect(joinList(['This tag is missing'])).toBe('This tag is missing');
    expect(joinList(['A', 'This page', 'That page'])).toBe('A, this page and That page');
  });

  it('drops double spaces and a dangling punctuation mark', () => {
    expect(tidySentence('Found  1 issue .')).toBe('Found 1 issue.');
    expect(tidySentence('Done..')).toBe('Done.');
    expect(tidySentence('Wait...')).toBe('Wait.');
    expect(tidySentence('A , B and C .')).toBe('A, B and C.');
    expect(tidySentence('  ')).toBe('');
    expect(tidySentence('Found 1 issue: This page is thin.')).toBe('Found 1 issue: this page is thin.');
    expect(tidySentence('Short page and This tag is missing.')).toBe('Short page and this tag is missing.');
    expect(tidySentence('A, This and That.')).toBe('A, this and That.');
    expect(tidySentence('Not measured. This run did not measure the site.')).toBe(
      'Not measured. This run did not measure the site.',
    );
  });

  it('summarizes zero, one, two, and many findings', () => {
    expect(findingSummary([])).toBe('No issues were found.');
    expect(findingSummary(['Short page'])).toBe('Found 1 issue: Short page.');
    expect(findingSummary(['Short page', 'Missing tag'])).toBe('Found 2 issues: Short page and Missing tag.');
    expect(findingSummary(['This page is thin'])).toBe('Found 1 issue: this page is thin.');
    expect(findingSummary(['Short page', 'This tag is missing'])).toBe(
      'Found 2 issues: Short page and this tag is missing.',
    );
    expect(findingSummary(['A', 'B', 'C', 'D'])).toBe('Found 4 issues: A, B, C and D.');
    expect(findingSummary(['  ', 'A'])).toBe('Found 1 issue: A.');
  });
});