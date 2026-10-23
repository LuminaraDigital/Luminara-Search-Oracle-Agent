import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReportDisplay } from '../components/audit/ReportDisplay';
import { updateQuotaFromHeaders } from '../services/apiClient';

describe('free share call to action', () => {
  it('keeps the free-win sentence and hides the paywalled copy-share button', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
    updateQuotaFromHeaders(new Headers({ 'x-quota-limit': '3', 'x-quota-remaining': '2' }));
    const html = renderToStaticMarkup(createElement(ReportDisplay, {
      markdownText: '# Report\n\nA page.',
      targetDomain: 'luminara.digital',
    }));
    expect(html).toContain('A measured win can be shared on the free plan.');
    expect(html).not.toContain('Copy share link');
  });
});
