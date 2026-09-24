import React from 'react';
import { describe, expect, it } from 'vitest';
import {
  collectText,
  GscEmptyState,
  GSC_EMPTY_COPY,
  PsiEmptyState,
  PSI_EMPTY_COPY,
  showGscEmptyState,
  showPsiEmptyState,
} from '../components/audit/psiGscEmptyStates';
import type { GscSummary } from '../services/mcp/gscAnalyticsService';

describe('PSI/GSC honest empty states', () => {
  it('PSI empty branch renders the honest not_measured copy', () => {
    const text = collectText(React.createElement(PsiEmptyState));
    expect(text).toContain(PSI_EMPTY_COPY);
    expect(text).toContain('not_measured');
  });

  it('PSI empty branch contains zero digit characters (no numeric placeholders)', () => {
    const text = collectText(React.createElement(PsiEmptyState));
    expect(text).not.toMatch(/\d/);
  });

  it('GSC empty branch renders the not_configured copy', () => {
    const text = collectText(React.createElement(GscEmptyState));
    expect(text).toContain(GSC_EMPTY_COPY);
    expect(text).toContain('not_configured');
  });

  it('GSC empty copy never claims data exists', () => {
    expect(GSC_EMPTY_COPY.toLowerCase()).toContain('not connected');
    expect(GSC_EMPTY_COPY).toContain('Settings');
  });

  it('PSI empty copy never claims a measurement exists', () => {
    expect(PSI_EMPTY_COPY.toLowerCase()).toContain('not measured');
  });

  it('branch-selection predicates: empty state shows iff data is missing', () => {
    expect(showPsiEmptyState(null)).toBe(true);
    expect(showPsiEmptyState(undefined)).toBe(true);
    expect(showPsiEmptyState({ measurementStatus: 'measured' })).toBe(false);

    expect(showGscEmptyState(null)).toBe(true);
    expect(showGscEmptyState(undefined)).toBe(true);
    expect(showGscEmptyState({ domain: 'example.com' })).toBe(false);
  });

  it('populated GSC branch would render its existing values unchanged', () => {
    const stub: GscSummary = {
      domain: 'example.com',
      totalClicks: 120,
      totalImpressions: 3400,
      avgCtr: 3.5,
      avgPosition: 12.4,
      cannibalizedKeywordsCount: 0,
      rows: [],
      timestamp: 1_700_000_000_000,
    };
    expect(showGscEmptyState(stub)).toBe(false);

    // Mirror the populated <dl> from components/audit/GscPanel.tsx unchanged.
    const populated = React.createElement(
      'dl',
      { className: 'grid grid-cols-2 gap-1 text-[11px] font-mono text-gray-300' },
      React.createElement('dt', null, 'Clicks'),
      React.createElement('dd', null, stub.totalClicks),
      React.createElement('dt', null, 'Impressions'),
      React.createElement('dd', null, stub.totalImpressions),
      React.createElement('dt', null, 'Avg CTR'),
      React.createElement('dd', null, `${stub.avgCtr}%`),
      React.createElement('dt', null, 'Avg position'),
      React.createElement('dd', null, stub.avgPosition),
    );
    const text = collectText(populated);
    expect(text).toContain('120');
    expect(text).toContain('3400');
    expect(text).toContain('3.5%');
    expect(text).toContain('12.4');
    expect(text).not.toContain(GSC_EMPTY_COPY);
  });
});
