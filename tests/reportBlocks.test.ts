import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuditReportArticle } from '../components/audit/AuditReportArticle';
import type { BoardFinding } from '../services/audit/findingBoardService';
import { FINDINGS_BOARD_KEY, listLocalFindings, setFindingStatusLocal } from '../services/audit/findingBoardService';
import {
  alignOneMove,
  fixProgress,
  parseAuditReport,
  progressSince,
  recheckLabel,
  reportScore,
  scoreLine,
  showFixTally,
  stripUnsupportedFixClaims,
  withReportLead,
} from '../services/audit/reportBlocks';
import { gateReportText } from '../services/audit/reportColumnGate';
import { formatAuDate } from '../utils/formatAuDate';

const SAMPLE = `# Ray White

The site checks were not measured.

## What to fix

- Add the agency name
- Keep the phone number

### Detail

A [suburb page](https://raywhite.com.au/richmond) helps.

\`\`\`json
{ "name": "Ray White" }
\`\`\`

| Check | Result |
| --- | --- |
| Homepage | Not measured |

**Not measured** stays visible.
`;

function finding(partial: Partial<BoardFinding> & Pick<BoardFinding, 'id' | 'title'>): BoardFinding {
  return {
    domain: 'raywhite.com.au',
    stableKey: partial.id,
    category: 'content_quality',
    severity: 'high',
    description: 'The homepage title does not name the agency.',
    status: 'open',
    evidence: { howWeKnowItFailed: 'The fetched title did not include the agency name.' },
    ...partial,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('audit report markdown', () => {
  it('maps headings, lists, code, tables, and links, and drops the markers', () => {
    const doc = parseAuditReport(SAMPLE);
    expect(doc.title).toBe('Ray White');
    expect(doc.verdict).toBe('The site checks were not measured.');
    expect(doc.sections.map((section) => section.title)).toEqual(['Ray White', 'What to fix']);
    const fix = doc.sections[1];
    const list = fix.blocks.find((block) => block.kind === 'list');
    expect(list && list.kind === 'list' ? list.items.map((item) => item.map((part) => part.text).join('')) : []).toEqual([
      'Add the agency name',
      'Keep the phone number',
    ]);
    const code = fix.blocks.find((block) => block.kind === 'code');
    expect(code && code.kind === 'code' ? code.text : '').toContain('{ "name": "Ray White" }');
    const table = fix.blocks.find((block) => block.kind === 'table');
    expect(table && table.kind === 'table' ? table.rows : []).toEqual([['Homepage', 'Not measured']]);
    expect(doc.links).toEqual([{ text: 'suburb page', href: 'https://raywhite.com.au/richmond' }]);
    expect(JSON.stringify(doc)).not.toContain('**');
    expect(JSON.stringify(doc)).not.toContain('```');
  });

  it('keeps reading malformed markdown and does not invent a score', () => {
    const doc = parseAuditReport('## Broken\n\n**oops\n\n| only one\n');
    expect(doc.sections[0].title).toBe('Broken');
    expect(doc.verdict).toContain('oops');
    expect(doc.verdict).not.toContain('**');
    expect(() => parseAuditReport('```\nnever closed')).not.toThrow();
    expect(parseAuditReport('```\nnever closed').sections.some((section) => section.blocks.some((block) => block.kind === 'code' && block.text.includes('never closed')))).toBe(true);

    expect(scoreLine('passed 3 of 4 checks', false)).toBe('Not measured');
    expect(scoreLine('passed 3 of 4 checks', true)).toBe('3 of 4 checks passed');
    expect(scoreLine('passed 2 of 4; 1 not measured', false)).toBe('2 of 4 checks passed, 1 failed, 1 not measured');
    expect(scoreLine('2 of 4 checks passed, 2 failed', true)).toBe('2 of 4 checks passed, 2 failed');
    expect(scoreLine('passed 4 of 4; 0 not measured', true)).toBe('4 of 4 checks passed');
    expect(scoreLine('passed 4 of 4; 0 not measured', false)).toBe('Not measured');
    expect(scoreLine('Health Score: 90', true)).toBe('Not measured');
    expect(scoreLine('passed 9 of 4 checks', true)).toBe('Not measured');
  });

  it('dates the recheck 14 days ahead and only shows a saved health change', () => {
    const from = new Date(2026, 0, 8).getTime();
    expect(recheckLabel(from)).toBe(`Recheck on ${formatAuDate(new Date(2026, 0, 22))}.`);
    expect(progressSince({ before: null, metrics: [] })).toBe('No earlier audit of this site is saved.');
    expect(progressSince({
      before: { id: 'earlier' },
      metrics: [{ key: 'healthScore', before: null, after: null, delta: null }],
    })).toBe('Health was not measured on both audits, so there is no change to show.');
    expect(progressSince({
      before: { id: 'earlier' },
      metrics: [{ key: 'healthScore', before: null, after: null, delta: null }],
      checks: { passed: 2, failed: 2, total: 4 },
    })).toBe('This run measured the site checks above. There is no earlier checklist to compare.');
    expect(progressSince({
      before: { id: 'earlier' },
      metrics: [{ key: 'healthScore', before: 70, after: 85, delta: 15 }],
    })).toBe('Health is up 15 since the last audit (70 to 85).');
    expect(fixProgress([
      { status: 'done' },
      { status: 'done' },
      { status: 'open' },
      { status: 'open' },
      { status: 'in_progress' },
    ]).label).toBe('2 of 5 fixes done');
  });

  it('puts the same score and fix on the PDF text', () => {
    const pdf = withReportLead(SAMPLE, false, [finding({ id: 'org', title: 'Add the agency name' })]);
    expect(pdf.startsWith('# Ray White\n\nScore: Not measured\n')).toBe(true);
    expect(pdf).toContain('Why it matters for buyers and vendors: The fetched title did not include the agency name.');
    expect(pdf).toContain('How to fix: The homepage title does not name the agency.');
    expect(pdf).not.toContain('Health Score:');
  });

  it('lists a downgraded finding under Not measured and keeps it out of the fix cards', () => {
    const findings = [
      finding({ id: 'org', title: 'Add the agency name' }),
      finding({
        id: 'finding-schema-org-unmeasured',
        title: 'Organization markup',
        description: 'Not measured. The evidence check did not support this finding.',
      }),
    ];
    const pdf = withReportLead('passed 2 of 4; 1 not measured', true, findings);
    expect(pdf).toContain('Score: 3 of 4 checks passed, 1 not measured');
    expect(pdf).toContain('How to fix: The homepage title does not name the agency.');
    expect(pdf).toContain('Not measured: Organization markup.');
    expect(pdf).not.toContain('### Organization markup');
    const html = renderToStaticMarkup(createElement(AuditReportArticle, {
      markdown: 'passed 2 of 4; 1 not measured',
      measured: true,
      findings,
      domain: 'raywhite.com.au',
      showActions: false,
    }));
    expect(html).toContain('3 of 4 checks passed, 1 not measured');
    expect(html).toContain('Not measured: Organization markup.');
    expect(html.match(/Mark done/g)).toHaveLength(1);
    const stripped = stripUnsupportedFixClaims(
      [
        '## 1. One move this week',
        '',
        'Add Organization markup.',
        '',
        '## 3. Fix list',
        '',
        '| Task | Plain issue |',
        '| --- | --- |',
        '| Add Organization JSON-LD | No schema |',
        '| Thin Content Detected on Critical Landing Page(s) | Short pages |',
        '',
        '## 6. Budget notes',
        '',
        'Budget impact: Not measured.',
      ].join('\n'),
      [{ id: 'finding-thin-content-unmeasured' }],
    );
    expect(stripped).toContain('Add Organization JSON-LD');
    expect(stripped).toContain('Add Organization markup.');
    expect(stripped).toContain('Budget impact: Not measured.');
    expect(stripped).not.toContain('Thin Content');
    expect(html).not.toContain('evidence check did not support');
  });
});

describe('audit report page', () => {
  it('renders the score, the next fix, and the source without a raw marker', () => {
    const findings = [
      finding({ id: 'org', title: 'Add the agency name', severity: 'critical' }),
      finding({ id: 'phone', title: 'Publish the office phone', severity: 'medium', description: 'No telephone was in the schema.', evidence: { howWeKnowItFailed: 'Not measured.' } }),
    ];
    const html = renderToStaticMarkup(createElement(AuditReportArticle, {
      markdown: SAMPLE,
      measured: false,
      findings,
      domain: 'raywhite.com.au',
      sources: [{ uri: 'https://raywhite.com.au/richmond', title: 'Richmond office' }],
      showActions: false,
    }));
    expect(html).toContain('Not measured');
    expect(html).toContain('The site checks were not measured.');
    expect(html).toContain('Your next fix');
    expect(html).toContain('Why it matters for buyers and vendors');
    expect(html).toContain('0 of 2 fixes done');
    expect(html).toContain('Mark done');
    expect(html).toContain('>Copy<');
    expect(html).toContain('https://raywhite.com.au/richmond');
    expect(html).toContain('Richmond office');
    expect(html).not.toContain('**');
    expect(html).not.toContain('```');
    expect(html).toContain('No earlier audit of this site is saved.');
  });

  it('does not print a second pass count beside the 4 site checks', () => {
    expect(showFixTally('2 of 4 checks passed, 2 failed')).toBe(false);
    expect(showFixTally('Not measured')).toBe(true);
    const html = renderToStaticMarkup(createElement(AuditReportArticle, {
      markdown: 'passed 2 of 4; 1 not measured',
      measured: true,
      findings: [
        finding({ id: 'schema-note', title: 'Add Organization markup' }),
        finding({ id: 'other', title: 'Rewrite the title' }),
      ],
      domain: 'raywhite.com.au',
      showActions: false,
    }));
    expect(html).toContain('2 of 4 checks passed, 1 failed, 1 not measured');
    expect(html).toContain('The score above is the only pass count for the site checks.');
    expect(html).not.toContain('fixes done');
  });

  it('scores from the same checklist as the brief when the model report omits it', () => {
    const findings = [
      finding({ id: 'finding-schema-org', title: 'Insert Organization JSON-LD', description: 'Tags on the page: none.' }),
      finding({ id: 'finding-thin-content', title: 'This page is too short', description: '133 words.' }),
    ];
    const markdown = '# Example\n\nThe homepage is thin.\n\n## 2. Plain verdict\n\nNo checklist sentence here.\n';
    expect(reportScore(markdown, false, findings)).toBe('2 of 4 checks passed, 2 failed');
    const html = renderToStaticMarkup(createElement(AuditReportArticle, {
      markdown,
      measured: false,
      findings,
      domain: 'example.com',
      sources: [
        { uri: 'https://example.com', title: 'example.com (Target Domain)' },
        { uri: 'https://en.wikipedia.org/wiki/Example.com', title: 'example.com - Wikipedia' },
      ],
      showActions: false,
    }));
    expect(html).toContain('2 of 4 checks passed, 2 failed');
    expect(html).not.toContain('Health was not measured');
    expect(html).toContain('The score above is the only pass count for the site checks.');
    expect(html).not.toContain('fixes done');
    expect(html).toContain('Add a business identity tag');
    expect(html).not.toContain('JSON-LD');
    expect(html).toContain('https://example.com example.com (page read)');
    expect(html).toContain('https://en.wikipedia.org/wiki/Example.com example.com - Wikipedia (web search)');
    const pdf = withReportLead(markdown, false, findings);
    expect(pdf).toContain('Score: 2 of 4 checks passed, 2 failed');
  });

  it('builds the one move, the how-to-know line, and the snippet from the top finding', () => {
    const raw = [
      '# Example',
      '',
      'The site is reachable but shows very thin content and no structured data.Security headers (HSTS, CSP) and a public security contact file are missing.These gaps lower the odds of a quote.',
      '',
      '## 1. One move this week',
      '',
      'Add an HTTP Strict\u2011Transport\u2011Security (HSTS) header so browsers always load the HTTPS version. How to know it worked: verify the response includes Strict-Transport-Security: max\u2011age=31536000; includeSubDomains',
      '',
      '```json',
      '{ "@context": "https://schema.org", "@type": "Organization", "name": "Example" }',
      '```',
      '',
      '## 3. Fix list',
      '',
      '| Task | Plain issue | Priority |',
      '| --- | --- | --- |',
      '| Implement Content\u2011Security\u2011Policy | Missing | High |',
      '| Publish a public security contact file (security.txt) | Missing | High |',
      '| Add a business identity tag markup | None | High |',
      '',
      '## 7. Sources',
      'https://example.com Example Domain (page read) https://en.wikipedia.org/wiki/Example.com example.com - Wikipedia (web search) https://leadiq.com/c/pge-systemy-sa PGE Systemy S.A | LeadIQ (web search)',
    ].join('\n');
    const findings = [
      finding({
        id: 'finding-schema-org',
        title: 'Add a business identity tag',
        description: 'Tags on the page: none.',
        domain: 'example.com',
        severity: 'critical',
      }),
    ];
    const text = alignOneMove(gateReportText(raw), findings, 'example.com');
    const doc = parseAuditReport(text);
    const move = doc.sections.find((section) => /one move/i.test(section.title));
    const prose = move?.blocks.filter((block) => block.kind === 'paragraph').map((block) => block.kind === 'paragraph' ? block.text : '').join(' ') || '';
    const code = move?.blocks.find((block) => block.kind === 'code');
    expect(prose).toContain('Add a business identity tag.');
    expect(prose).toContain('How to know it worked: the page source includes a business identity tag that names the organization.');
    expect(prose).not.toContain('Strict-Transport-Security');
    expect(prose).not.toContain('max-age');
    expect(code && code.kind === 'code' ? code.text : '').toContain('"@type": "Organization"');
    const html = renderToStaticMarkup(createElement(AuditReportArticle, {
      markdown: raw,
      measured: false,
      findings,
      domain: 'example.com',
      clientName: 'Example',
      sources: [
        { uri: 'https://example.com', title: 'Example Domain' },
        { uri: 'https://leadiq.com/c/pge-systemy-sa', title: 'PGE Systemy S.A | LeadIQ' },
        { uri: 'https://en.wikipedia.org/wiki/Example.com', title: 'example.com - Wikipedia' },
      ],
      showActions: false,
    }));
    expect(html).toContain('Your next fix');
    expect(html).toContain('Add a business identity tag');
    expect(html).toContain('How to know it worked: the page source includes a business identity tag');
    expect(html).toContain('The page is reachable. A business identity tag is missing.');
    expect(html).toContain('This gap can lower trust and citation odds.');
    expect(html).not.toContain('Strict-Transport-Security');
    expect(html).not.toContain('Content-Security-Policy');
    expect(html).not.toContain('tag markup');
    expect(html).not.toContain('leadiq.com');
    expect(html).not.toContain('[[');
    expect(html).toContain('<ul');
    expect(html).toContain('https://example.com Example Domain (page read)');
    expect(html).toContain('https://en.wikipedia.org/wiki/Example.com example.com - Wikipedia (web search)');
    expect(html).not.toContain('\u2014');
    const withoutFindings = parseAuditReport(alignOneMove(gateReportText(raw), []));
    const fallback = withoutFindings.sections.find((section) => /one move/i.test(section.title));
    const fallbackCode = fallback?.blocks.find((block) => block.kind === 'code');
    const fallbackProse = fallback?.blocks.filter((block) => block.kind === 'paragraph').map((block) => block.kind === 'paragraph' ? block.text : '').join(' ') || '';
    expect(fallbackProse).toContain('Make browsers always use the secure version of your site (HSTS)');
    expect(fallbackCode).toBeUndefined();
  });

  it('scrubs the live verdict and the glued security row in the article', () => {
    const verdict = 'Security headers and a basic Organization schema are missing, which can lower trust and citation odds.';
    const raw = [
      '# Example',
      '',
      verdict,
      '',
      'Security headers and a basic JSON-LD are missing, which can lower trust and citation odds.',
      '',
      '## 3. Fix list',
      '',
      '| Task | Plain issue | Priority |',
      '| --- | --- | --- |',
      '| Publish aa public security contact file (security.txt)file | Missing | High |',
    ].join('\n');
    const expectedVerdict = 'Security headers and a basic business identity tag are missing, which can lower trust and citation odds.';
    const expectedFix = 'Publish a public security contact file (security.txt)';
    expect(gateReportText(verdict)).toBe(expectedVerdict);
    expect(gateReportText('Publish aa public security contact file (security.txt)file')).toBe(expectedFix);
    const html = renderToStaticMarkup(createElement(AuditReportArticle, {
      markdown: raw,
      measured: false,
      findings: [],
      domain: 'example.com',
      clientName: 'Example',
      showActions: false,
    }));
    expect(html).toContain(expectedVerdict);
    expect(html).toContain(expectedFix);
    expect(html).not.toContain('Add a business identity tag are missing');
    expect(html).not.toContain('aa public');
    expect(html).not.toContain('(security.txt)file');
    expect(html).not.toContain('\u2014');
  });

  it('stores a done tick on the findings board without calling the network', () => {
    const local = new Map<string, string>();
    const session = new Map<string, string>();
    const store = (bag: Map<string, string>) => ({
      getItem: (key: string) => bag.get(key) ?? null,
      setItem: (key: string, value: string) => { bag.set(key, value); },
      removeItem: (key: string) => { bag.delete(key); },
    });
    vi.stubGlobal('localStorage', store(local));
    vi.stubGlobal('sessionStorage', store(session));
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const rows = [finding({ id: 'org', title: 'Add the agency name' })];
    const saved = setFindingStatusLocal('https://www.raywhite.com.au', rows, 'org', 'done');
    expect(saved[0].status).toBe('done');
    expect(listLocalFindings('raywhite.com.au')[0].status).toBe('done');
    expect(local.get(FINDINGS_BOARD_KEY)).toContain('"status":"done"');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
