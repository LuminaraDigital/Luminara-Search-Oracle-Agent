import { describe, expect, it } from 'vitest';
import { SYSTEM_INSTRUCTIONS } from '../constants';
import { fitAuditWritePrompt } from '../services/audit/compactAuditEvidence';
import { generateGenUISystemPrompt } from '../services/genui/promptGenerator';
import { UNTRUSTED_CONTENT_RULE, wrapUntrustedContent } from '../utils/untrustedContent';

function productionSizedPrompt(): { user: string; system: string } {
  const page = (name: string, words: number) =>
    [
      `--- PAGE (${name}) https://www.movida.com.au/${name.toLowerCase()} via direct ---`,
      `Title: MoVida ${name}`,
      'Schemas: none',
      `Word count: ${words}`,
      `[DISTILLED CONTENT CORE]:`,
      'The restaurant serves Spanish food in Melbourne. '.repeat(40),
      'The restaurant serves Spanish food in Melbourne. '.repeat(40),
    ].join('\n');
  const scraped = ['[SITEWIDE EVIDENCE PACK]', page('HOME', 842), page('MENU', 1200), page('ABOUT', 900)].join(
    '\n',
  );
  const sources = Array.from({ length: 8 }, (_item, index) =>
    `[Source ${index + 1}] Result ${index + 1}\nURL: https://example.com/${index}\nExcerpt: ${'Long search excerpt about restaurants. '.repeat(12)}\n`,
  ).join('\n');
  const empirical = [
    'Citation Rate: 33% (1/3 sampled queries)',
    'Top Cited Competitor: not measured',
    ...Array.from({ length: 8 }, (_item, index) => `- ESTIMATED: Query "movida ${index}" (informational): not found`),
  ].join('\n');
  const system = `${SYSTEM_INSTRUCTIONS}\n\n${UNTRUSTED_CONTENT_RULE}\n\n${generateGenUISystemPrompt()}`;
  const user = [
    `[SEO METHODOLOGY PLAYBOOKS]\n${'Apply the published check and write not measured when data is missing. '.repeat(70)}`,
    wrapUntrustedContent('SCRAPED_PAGE', `${scraped.slice(0, 4000)}\n[...content truncated for token budget]`),
    wrapUntrustedContent('SEARCH_GROUNDING', `${sources.slice(0, 3500)}\n[...search evidence truncated for token budget]`),
    wrapUntrustedContent('EMPIRICAL', empirical),
    'Include sameAs only for URLs that appear as links in the scraped page. Otherwise omit sameAs.',
    'Grade only what scraped page and search evidence support. Anything unobserved is "not measured".',
  ].join('\n');
  return { user, system };
}

describe('compact audit write prompt', () => {
  it('keeps measured facts and lands under 5000 input tokens', () => {
    const { user, system } = productionSizedPrompt();
    const fitted = fitAuditWritePrompt(user, system);
    expect(fitted.beforeTokens).toBeGreaterThan(fitted.afterTokens);
    expect(fitted.afterTokens).toBeLessThan(5000);
    expect(fitted.text).toContain('Word count: 842');
    expect(fitted.text).toContain('Schemas: none');
    expect(fitted.text).toContain('Citation Rate: 33%');
    expect(fitted.text).toContain('not measured');
    expect(fitted.text).not.toContain('PAGE (ABOUT)');
    expect(fitted.text).not.toContain('[Source 8]');
    expect(fitted.beforeTokens).toBeGreaterThan(5000);
    expect(fitted.afterTokens).toBeLessThan(4000);
  });
});
