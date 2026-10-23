import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReportDisplay } from '../components/audit/ReportDisplay';
import { updateQuotaFromHeaders } from '../services/apiClient';
import { canCreateShareLinks } from '../services/share/shareReportClient';

const FREE_WIN = 'A measured win can be shared on the free plan.';

function reportHtml(): string {
  return renderToStaticMarkup(createElement(ReportDisplay, {
    markdownText: '# Report\n\nA page.',
    targetDomain: 'luminara.digital',
  }));
}

describe('free share call to action', () => {
  it('keeps the free-win sentence and hides the paywalled copy-share button', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    updateQuotaFromHeaders(new Headers({ 'x-quota-limit': '3', 'x-quota-remaining': '2', 'x-quota-plan': 'free' }));
    const free = reportHtml();
    expect(free).toContain(FREE_WIN);
    expect(free).not.toContain('Copy share link');
    expect(canCreateShareLinks()).toBe(false);

    updateQuotaFromHeaders(new Headers({ 'x-quota-limit': '3', 'x-quota-remaining': '2', 'x-quota-plan': 'starter' }));
    const starter = reportHtml();
    expect(starter).toContain(FREE_WIN);
    expect(starter).not.toContain('Copy share link');
    expect(canCreateShareLinks()).toBe(false);

    // A new free account can still receive an unlimited daily-cap header. That is not Growth.
    updateQuotaFromHeaders(new Headers({ 'x-quota-limit': 'unlimited', 'x-quota-remaining': 'unlimited' }));
    const unlimitedCap = reportHtml();
    expect(unlimitedCap).toContain(FREE_WIN);
    expect(unlimitedCap).not.toContain('Copy share link');
    expect(canCreateShareLinks()).toBe(false);

    updateQuotaFromHeaders(new Headers({ 'x-quota-limit': 'unlimited', 'x-quota-remaining': 'unlimited', 'x-quota-plan': 'growth' }));
    const growth = reportHtml();
    expect(growth).toContain(FREE_WIN);
    expect(growth).toContain('Copy share link');
    expect(canCreateShareLinks()).toBe(true);

    updateQuotaFromHeaders(new Headers({ 'x-quota-limit': 'unlimited', 'x-quota-remaining': 'unlimited', 'x-quota-plan': 'agency' }));
    expect(reportHtml()).toContain('Copy share link');
    expect(canCreateShareLinks()).toBe(true);
  });
});
