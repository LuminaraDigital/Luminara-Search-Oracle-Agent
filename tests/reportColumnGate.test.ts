import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CompetitorMap } from '../components/audit/CompetitorMap';
import { VisibilityRadar } from '../components/audit/VisibilityRadar';
import { isUnmeasuredReportColumn, stripUnmeasuredReportColumns } from '../services/audit/reportColumnGate';

function tableHeaders(markdown: string): string[] {
  const lines = markdown.split('\n');
  const headers: string[] = [];
  lines.forEach((line, index) => {
    const next = lines[index + 1] || '';
    if (line.trim().startsWith('|') && next.includes('---')) {
      headers.push(...line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()));
    }
  });
  return headers;
}

const OLD_SHAPE_REPORT = [
  '# Luminara: Will AI mention Example?',
  '',
  '## 3. Fix list',
  '| Task | Plain issue | Expected Impact | Priority |',
  '|------|-------------|-----------------|----------|',
  '| Add Organization schema | AI cannot tell who you are | +40% citations | High |',
  '',
  '## AI & Search Visibility Radar',
  '| Query | Intent | Brand Cited (Yes/No) | Key Competitors | Est. Organic Rank | Rich Results | AI Overview Status | Citation Status (Cited/Not Cited/Not Measured) |',
  '|---|---|---|---|---|---|---|---|',
  '| what is example.com | informational | Yes | Rival | Position 3 | FAQ snippet | Active | Cited |',
  '',
  '## Competitor Reality Map',
  '| Entity | AI Perception (Tone/Claims) | Top Cited Page Types | Content Advantage (vs You) | Trust Signal Strength (Low/Med/High) |',
  '|---|---|---|---|---|',
  '| Example | Clear | Homepage | None | Medium-High |',
].join('\n');

describe('report column gate (SW0a-7)', () => {
  it('names the five columns no evidence row can fill, in either prompt wording', () => {
    for (const header of [
      'Expected Impact',
      'Impact',
      'Est. Organic Rank',
      'Organic rank',
      'Rich Results',
      'AI Overview Status',
      'AI Overview',
      'Trust Signal Strength (Low/Med/High)',
      'Trust signals',
      '**Expected Impact**',
    ]) {
      expect(isUnmeasuredReportColumn(header), header).toBe(true);
    }
    for (const header of [
      'Task',
      'Plain issue',
      'Priority',
      'Query',
      'Intent',
      'Brand Cited (Yes/No)',
      'Key Competitors',
      'Citation Status (Cited/Not Cited/Not Measured)',
      'Entity',
      'AI Perception (Tone/Claims)',
      'Top Cited Page Types',
      'Content Advantage (vs You)',
    ]) {
      expect(isUnmeasuredReportColumn(header), header).toBe(false);
    }
  });

  it('removes rank, impact, rich result, AI Overview and trust signal columns and their cells', () => {
    const cleaned = stripUnmeasuredReportColumns(OLD_SHAPE_REPORT);

    expect(tableHeaders(cleaned)).toEqual([
      'Task', 'Plain issue', 'Priority',
      'Query', 'Intent', 'Brand Cited (Yes/No)', 'Key Competitors', 'Citation Status (Cited/Not Cited/Not Measured)',
      'Entity', 'AI Perception (Tone/Claims)', 'Top Cited Page Types', 'Content Advantage (vs You)',
    ]);
    for (const invented of ['+40% citations', 'Position 3', 'FAQ snippet', 'Active', 'Medium-High']) {
      expect(cleaned).not.toContain(invented);
    }
    // The cells that stay keep their place under their own header.
    expect(cleaned).toContain('| Add Organization schema | AI cannot tell who you are | High |');
    expect(cleaned).toContain('| what is example.com | informational | Yes | Rival | Cited |');
    expect(cleaned).toContain('| Example | Clear | Homepage | None |');
    // Every row of a rewritten table has as many cells as its header.
    expect(cleaned).toContain('| --- | --- | --- | --- | --- |');
    expect(cleaned).toContain('## AI & Search Visibility Radar');
  });

  it('returns a report with no such column unchanged, byte for byte', () => {
    const clean = [
      '# Report',
      '',
      '| Task | Plain issue | Priority |',
      '|------|:-----------:|---------:|',
      '| Add schema | Missing   | High |',
      '',
      'Budget impact: not measured.',
      '| a lone line that starts with a pipe',
    ].join('\n');
    expect(stripUnmeasuredReportColumns(clean)).toBe(clean);
    expect(stripUnmeasuredReportColumns('')).toBe('');
  });

  it('leaves a table inside a code fence alone', () => {
    const fenced = [
      '```markdown',
      '| Query | Est. Organic Rank |',
      '|---|---|',
      '| q | 1 |',
      '```',
    ].join('\n');
    expect(stripUnmeasuredReportColumns(fenced)).toBe(fenced);
  });

  it('handles rows with no closing pipe and drops a table that held only unmeasured columns', () => {
    const ragged = [
      '| Query | Organic rank',
      '|---|---',
      '| q1 | 4',
      '',
      '| Impact | Trust signals |',
      '|---|---|',
      '| High | Low |',
      'After.',
    ].join('\n');
    expect(stripUnmeasuredReportColumns(ragged)).toBe(['| Query |', '| --- |', '| q1 |', '', 'After.'].join('\n'));
  });
});

describe('report cards draw only the columns a table carries (SW0a-7)', () => {
  const radarRow = ['what is example.com', 'informational', 'Yes', 'Rival', 'Cited'];
  const newRadarHeaders = ['Query', 'Intent', 'Brand Cited (Yes/No)', 'Key Competitors', 'Citation Status (Cited/Not Cited/Not Measured)'];

  it('shows no rank or AI Overview cell for a radar table without those columns', () => {
    const html = renderToStaticMarkup(createElement(VisibilityRadar, { headers: newRadarHeaders, rows: [radarRow] }));
    expect(html).toContain('what is example.com');
    expect(html).toContain('Rival');
    expect(html).not.toContain('Organic rank');
    expect(html).not.toContain('AI engine status');
    expect(html).not.toContain('Traditional SERP');
    expect(html).not.toContain('AI Overview active');
  });

  it('still reads rank and AI Overview by header for a stored report that has them', () => {
    const html = renderToStaticMarkup(createElement(VisibilityRadar, {
      headers: ['Query', 'Intent', 'Brand cited', 'Competitors', 'Organic rank', 'AI Overview', 'Status'],
      rows: [['q', 'informational', 'Yes', 'Rival', 'Position 3', 'Active', 'Cited']],
    }));
    expect(html).toContain('Organic rank');
    expect(html).toContain('Position 3');
    expect(html).toContain('AI Overview active');
  });

  it('shows no trust signal label for a competitor table without that column', () => {
    const html = renderToStaticMarkup(createElement(CompetitorMap, {
      headers: ['Entity', 'AI Perception (Tone/Claims)', 'Top Cited Page Types', 'Content Advantage (vs You)'],
      rows: [['Example', 'Clear', 'Homepage', 'None'], ['Rival', 'Strong', 'Comparison pages', 'Comparisons']],
    }));
    expect(html).toContain('Rival');
    expect(html).not.toContain('Trust Signal Strength');
    expect(html).not.toMatch(/>\s*medium\s*</i);
  });

  it('shows a trust signal only when the table has the column and the cell has text', () => {
    const headers = ['Entity', 'AI Perception', 'Top Cited Page Types', 'Content Advantage', 'Trust Signal Strength (Low/Med/High)'];
    const withCell = renderToStaticMarkup(createElement(CompetitorMap, {
      headers,
      rows: [['Example', 'Clear', 'Homepage', 'None', 'High']],
    }));
    expect(withCell).toContain('Trust Signal Strength');
    expect(withCell).toMatch(/>\s*high\s*</i);

    const emptyCell = renderToStaticMarkup(createElement(CompetitorMap, {
      headers,
      rows: [['Example', 'Clear', 'Homepage', 'None', '']],
    }));
    expect(emptyCell).not.toContain('Trust Signal Strength');
    expect(emptyCell).not.toMatch(/>\s*medium\s*</i);
  });
});
