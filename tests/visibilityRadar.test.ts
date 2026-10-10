import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import * as radar from '../components/audit/VisibilityRadar';
import { VisibilityRadar, readBrandCited } from '../components/audit/VisibilityRadar';

const HEADERS = ['Query', 'Intent', 'Brand Cited (Yes/No)', 'Key Competitors', 'Citation Status (Cited/Not Cited/Not Measured)'];

describe('VisibilityRadar honesty', () => {
  it('no longer averages digits found in the last cell into a score', () => {
    // "Cited (2 of 5)" used to become "Blended authority 25/100".
    expect('computeRadarAverage' in radar).toBe(false);
    expect('parseRadarItemScore' in radar).toBe(false);
    const html = renderToStaticMarkup(createElement(VisibilityRadar, {
      headers: HEADERS,
      rows: [
        ['q1', 'informational', 'Yes', 'Rival', 'Cited (2 of 5)'],
        ['q2', 'commercial', 'No', 'Rival', 'Not cited'],
      ],
    }));
    expect(html).not.toMatch(/\d+\s*\/\s*100/);
    expect(html).not.toMatch(/\d+%/);
    expect(html).not.toContain('Blended authority');
    expect(html).toContain('Cited (2 of 5)');
  });

  it('shows the citation status the table gives, and "Not measured" when it gives none', () => {
    const html = renderToStaticMarkup(createElement(VisibilityRadar, {
      headers: HEADERS,
      rows: [['q1', 'informational', 'not measured', 'Rival', '']],
    }));
    expect(html).toContain('Citation status:');
    expect(html).not.toContain('Radar score');
    expect(html).not.toContain('not_measured');
    expect((html.match(/Not measured/g) || []).length).toBe(2);
  });

  it('reads only a plain yes or no as a reading', () => {
    expect(readBrandCited('Yes')).toBe('yes');
    expect(readBrandCited('yes (estimated)')).toBe('yes');
    expect(readBrandCited('No')).toBe('no');
    expect(readBrandCited('Not cited')).toBe('no');
    expect(readBrandCited('not measured')).toBe('not_measured');
    expect(readBrandCited('not verified')).toBe('not_measured');
    expect(readBrandCited('None')).toBe('not_measured');
    expect(readBrandCited(undefined)).toBe('not_measured');
  });
});
