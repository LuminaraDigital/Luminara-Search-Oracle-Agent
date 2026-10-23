import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { PastReports } from '../components/audit/PastReports';
import { setAccountSignedIn } from '../services/apiClient';
import { auditHistoryService } from '../services/audit/auditHistoryService';
import { SAVED_AUDIT_CHECK_COPY } from '../services/audit/reportBlocks';

afterEach(() => {
  auditHistoryService.clear();
  setAccountSignedIn(null);
});

describe('past reports empty state', () => {
  it('shows an empty list instead of hiding the section', () => {
    auditHistoryService.clear();
    const html = renderToStaticMarkup(createElement(PastReports, { onOpen: () => {} }));
    expect(html).toContain('Past reports');
    expect(html).toContain('No saved reports yet');
    expect(html).toContain('not saved as a full report');
  });

  it('does not say there is no earlier audit while a signed-in pull is still open', () => {
    setAccountSignedIn(true);
    const html = renderToStaticMarkup(createElement(PastReports, { onOpen: () => {} }));
    expect(html).toContain(SAVED_AUDIT_CHECK_COPY);
    expect(html).not.toContain('No saved reports yet');
  });
});
